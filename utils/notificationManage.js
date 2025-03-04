const db = require('./dbConnection'); // 数据库模块

// 方法一：写入一条通知
const writeNotification = async (content, level, deviceID, location) => {
  const queryStr = `
    INSERT INTO notifications (content, level, deviceID, location, time, readIDs)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, JSON_ARRAY())
  `;
  
  try {
    db.query(queryStr, [content, level, deviceID, location],(error, results) => {
      if(error){
        throw error;
      }
      return results.insertId;
    });
  } catch (error) {
    throw error;
  }
};

// 方法二：对某条通知记录的 readIDs 添加用户 ID，标为已读
const markAsRead = async (notificationID, userID) => {
  return new Promise((resolve, reject) => {
    const queryStr = `
      UPDATE notifications
      SET readIDs = JSON_ARRAY_APPEND(readIDs, '$', ?)
      WHERE notificationID = ? AND JSON_CONTAINS(readIDs, JSON_ARRAY(?)) = 0
    `;
    
    try {
      db.query(queryStr, [userID, notificationID, userID],(error, results) => {
        if(error){
          reject(error);
        }
        resolve( results.affectedRows > 0);
      });
    } catch (error) {
      reject(error);
    }    
  })
};

// 方法三：对条件下的所有未标为某用户已读的通知全部已读
const markNotificationsAsRead = async (filter, userID) => {
  return new Promise((resolve, reject) => {
    // 1. 查找符合条件的通知，查询通知ID和当前的readIDs
    let queryStr = `
      SELECT notificationID, readIDs
      FROM notifications
      WHERE 1=1
    `;
    const queryParams = [];
    
    // 根据传入的 filter 动态添加查询条件
    if (filter.content) {
      queryStr += ' AND content LIKE ?';
      queryParams.push(`%${filter.content}%`);  // 使用模糊匹配
    }
    if (filter.device) {
      queryStr += ' AND device LIKE ?';
      queryParams.push(`%${filter.device}%`);
    }
    if (filter.level) {
      queryStr += ' AND level = ?';
      queryParams.push(filter.level);
    }
    // 根据 isRead 和 userID 判断已读状态
    if (filter.isRead && filter.isRead !== 'all') {
      if (filter.isRead === 'read') {
        queryStr += ' AND JSON_CONTAINS(readIDs, ?)';
        queryParams.push(JSON.stringify([userID]));  // 检查 readIDs 是否包含 userID
      } else if (filter.isRead === 'unread') {
        queryStr += ' AND NOT JSON_CONTAINS(readIDs, ?)';
        queryParams.push(JSON.stringify([userID]));  // 检查 readIDs 是否不包含 userID
      }
    }
    if (filter.startTime && filter.endTime) {
      queryStr += ' AND time BETWEEN ? AND ?';
      queryParams.push(filter.startTime, filter.endTime);
    }

    db.query(queryStr, queryParams, (error, results) => {
      if (error) {
        return reject(error);
      }

      // 获取所有符合条件的通知ID和readIDs
      const notificationsToUpdate = results;

      // 2. 更新这些通知，将 userID 加入 readIDs
      const updatePromises = notificationsToUpdate.map(notification => {
        const readIDs = notification.readIDs || '[]';

        // 如果用户ID还没有在readIDs中，加入它
        if (!readIDs.includes(userID)) {
          readIDs.push(userID);
        }

        // 更新通知的 readIDs
        const updateQuery = `
          UPDATE notifications
          SET readIDs = ?
          WHERE notificationID = ?
        `;
        return new Promise((resolveUpdate, rejectUpdate) => {
          db.query(updateQuery, [JSON.stringify(readIDs), notification.notificationID], (errorUpdate) => {
            if (errorUpdate) {
              rejectUpdate(errorUpdate);
            } else {
              resolveUpdate();
            }
          });
        });
      });

      // 等待所有更新操作完成
      Promise.all(updatePromises)
        .then(() => {
          // 返回更新的行数
          resolve(notificationsToUpdate.length);
        })
        .catch(reject);
    });
  });
};


// 方法四：获取某用户所有未读的通知数，并统计
function getUnreadNotificationsCountByLevel(userID) {
  return new Promise((resolve, reject) => {
    // 1. 查询未读通知总数并按等级统计
    let queryStr = `
      SELECT n.level, COUNT(*) AS count
      FROM notifications n
      WHERE NOT JSON_CONTAINS(n.readIDs, ?)
    `;
    const queryParams = [JSON.stringify([userID])];  // 检查 readIDs 是否不包含 userID

    // 2. 分组查询，按等级统计
    queryStr += ' GROUP BY n.level';

    // 执行查询
    db.query(queryStr, queryParams, (error, results) => {
      if (error) {
        return reject(error);
      }

      // 3. 格式化结果，返回一个包含各等级统计信息的对象
      const levelCounts = {
        error: 0,
        warning: 0,
        success: 0,
        normal: 0,
        total:0,
      };

      results.forEach(result => {
        if (result.level === 'error') {
          levelCounts.error = result.count;
        } else if (result.level === 'warning') {
          levelCounts.warning = result.count;
        } else if (result.level === 'success') {
          levelCounts.success = result.count;
        } else if (result.level === 'normal') {
          levelCounts.normal = result.count;
        }
      });
      levelCounts.total = results.length
      // 返回按等级统计的结果
      resolve(levelCounts);
    });
  });
}


// 方法五：获取所有通知（支持分页）
const getNotificationsByQuery = async (filter, start, end, userID) => {
  return new Promise((resolve, reject) => {
    let total = null
    let notification = []

    // 如果传入了设备名，通过设备名模糊查询 devices 表获取所有设备ID和名称
    if (filter.device) {
      // 1.先查所有设备ID和名称
      let deviceIDs = [];  // 用来存储设备ID
      let deviceMap = {};  // 设备名称的映射
      const queryStr1 = 'SELECT id, name FROM devices WHERE name LIKE ?';
      db.query(queryStr1, [`%${filter.device}%`], (error, results) => {
        if (error) {
          return reject(error);
        }

        // 生成设备ID和设备名称的映射
        deviceMap = results.reduce((acc, row) => {
          acc[row.id] = row.name;
          return acc;
        }, {});

        // 获取所有符合条件的设备ID
        deviceIDs = results.map(row => row.id);

        // 2. 获取符合条件的通知总数（用于分页）
        let queryStr2 = `
          SELECT COUNT(*) AS total
          FROM notifications
          WHERE 1=1
        `;
        const queryParams2 = [];
        if (filter.content) {
          queryStr2 += ' AND content LIKE ?';
          queryParams2.push(`%${filter.content}%`);
        }
        if (deviceIDs.length > 0) {
          queryStr2 += ' AND deviceID IN (?)';  // 使用查询到的所有 deviceID
          queryParams2.push(deviceIDs);  // 传入设备ID数组
        }
        if (filter.level) {
          queryStr2 += ' AND level = ?';
          queryParams2.push(filter.level);
        }
        // 根据 isRead 和 userID 判断已读状态
        if (filter.isRead && filter.isRead !== 'all') {
          if (filter.isRead === 'read') {
            queryStr2 += ' AND JSON_CONTAINS(readIDs, ?)';
            queryParams2.push(JSON.stringify([userID]));  // 检查 readIDs 是否包含 userID
          } else if (filter.isRead === 'unread') {
            queryStr2 += ' AND NOT JSON_CONTAINS(readIDs, ?)';
            queryParams2.push(JSON.stringify([userID]));  // 检查 readIDs 是否不包含 userID
          }
        }
        if (filter.startTime && filter.endTime) {
          queryStr2 += ' AND time BETWEEN ? AND ?';
          queryParams2.push(filter.startTime, filter.endTime);
        }
        if (filter.location) {
          queryStr2 += ' AND location = ?';
          queryParams2.push(filter.location);
        }

        db.query(queryStr2, queryParams2, (error, results) => {
          if(error){
            reject(error);
          }
          total=results[0].total// 返回符合条件的总数

          // 3. 构建通知内容查询
          if(total===0) {
            resolve([notification,total])
          } else {  
            let queryStr3 = `
              SELECT notificationID, content, level, time, deviceID, location, readIDs
              FROM notifications
              WHERE 1=1
            `;
            // 存储查询条件的参数数组
            const queryParams3 = [];
            // 根据传入的 filter 动态添加查询条件
            if (filter.content) {
              queryStr3 += ' AND content LIKE ?';
              queryParams3.push(`%${filter.content}%`);  // 使用模糊匹配
            }
            if (deviceIDs.length > 0) {
              queryStr3 += ' AND deviceID IN (?)';  // 使用查询到的所有 deviceID
              queryParams3.push(deviceIDs);  // 传入设备ID数组
            }
            if (filter.level) {
              queryStr3 += ' AND level = ?';
              queryParams3.push(filter.level);
            }
            // 根据 isRead 和 userID 判断已读状态
            if (filter.isRead && filter.isRead !== 'all') {
              if (filter.isRead === 'read') {
                queryStr3 += ' AND JSON_CONTAINS(readIDs, ?)';
                queryParams3.push(JSON.stringify([userID]));  // 检查 readIDs 是否包含 userID
              } else if (filter.isRead === 'unread') {
                queryStr3 += ' AND NOT JSON_CONTAINS(readIDs, ?)';
                queryParams3.push(JSON.stringify([userID]));  // 检查 readIDs 是否不包含 userID
              }
            }
            if (filter.startTime && filter.endTime) {
              queryStr3 += ' AND time BETWEEN ? AND ?';
              queryParams3.push(filter.startTime, filter.endTime);
            }
            if (filter.location) {
              queryStr3 += ' AND location = ?';
              queryParams3.push(filter.location);
            }
            // 添加排序和分页
            queryStr3 += ' ORDER BY time DESC LIMIT ? OFFSET ?';
            queryParams3.push(end - start + 1, start);  // 添加分页参数
          
            // 执行查询通知数据
            db.query(queryStr3, queryParams3, (error, results) => {
              if (error) {
                return reject(error);
              }
            
              // 将查询到的通知数据中的 deviceID 替换为对应的设备名称，并转换 readIDs 为 isRead
              const notificationWithNamesAndStatus = results.map(notification => {
                // 查找 deviceID 对应的设备名称，如果没有找到则为 null
                notification.deviceName = deviceMap[notification.deviceID] || null;
                delete notification.deviceID;  // 删除 deviceID 只保留 deviceName
              
                // 转换 readIDs 为 isRead
                if (notification.readIDs.includes(userID)) {
                  notification.isRead = true;  // 如果 readIDs 包含 userID，设置为已读
                } else {
                  notification.isRead = false;  // 如果 readIDs 不包含 userID，设置为未读
                }
                delete notification.readIDs;  // 删除 readIDs，因为已经转换为 isRead

                // 转换时间格式
                notification.time = formatDate(notification.time);

                return notification;
              });
            
              notification=notificationWithNamesAndStatus// 返回处理过的通知列表

              resolve([notification,total])
            });
          }
        });
      });
    } 
    // 如果没有传设备名，则直接执行通知查询（不基于设备ID）
    else {
      // 1.先查总数
      let queryStr1 = `
        SELECT COUNT(*) AS total
        FROM notifications
        WHERE 1=1
      `;
      const queryParams1 = [];
      if (filter.content) {
        queryStr1 += ' AND content LIKE ?';
        queryParams1.push(`%${filter.content}%`);
      }
      if (filter.device) {
        queryStr1 += ' AND device LIKE ?';
        queryParams1.push(`%${filter.device}%`);
      }
      if (filter.level) {
        queryStr1 += ' AND level = ?';
        queryParams1.push(filter.level);
      }
      // 根据 isRead 和 userID 判断已读状态
      if (filter.isRead && filter.isRead !== 'all') {
        if (filter.isRead === 'read') {
          queryStr1 += ' AND JSON_CONTAINS(readIDs, ?)';
          queryParams1.push(JSON.stringify([userID]));  // 检查 readIDs 是否包含 userID
        } else if (filter.isRead === 'unread') {
          queryStr1 += ' AND NOT JSON_CONTAINS(readIDs, ?)';
          queryParams1.push(JSON.stringify([userID]));  // 检查 readIDs 是否不包含 userID
        }
      }
      if (filter.location) {
        queryStr1 += ' AND location = ?';
        queryParams1.push(filter.location);
      }
      if (filter.startTime && filter.endTime) {
        queryStr1 += ' AND time BETWEEN ? AND ?';
        queryParams1.push(filter.startTime, filter.endTime);
      }

      db.query(queryStr1, queryParams1, (error, results) => {
        if(error){
          reject(error);
        }
        total=results[0].total// 返回符合条件的总数

        // 2. 直接查询设备名称
        if(total===0) {
          resolve([notification,total])
        } else {  
          let queryStr2 = `
            SELECT n.notificationID, n.content, n.level, n.time, n.deviceID, d.name AS deviceName, n.readIDs, n.location, l.nameCHN
            FROM notifications n
            LEFT JOIN devices d ON n.deviceID = d.id
            LEFT JOIN locations l ON n.location = l.nameENG
            WHERE 1=1
          `;
          // 存储查询条件的参数数组
          const queryParams2 = [];
          // 根据传入的 filter 动态添加查询条件
          if (filter.content) {
            queryStr2 += ' AND n.content LIKE ?';
            queryParams2.push(`%${filter.content}%`);  // 使用模糊匹配
          }
          if (filter.level) {
            queryStr2 += ' AND n.level = ?';
            queryParams2.push(filter.level);
          }
          // 根据 isRead 和 userID 判断已读状态
          if (filter.isRead && filter.isRead !== 'all') {
            if (filter.isRead === 'read') {
              queryStr2 += ' AND JSON_CONTAINS(n.readIDs, ?)';
              queryParams2.push(JSON.stringify([userID]));  // 检查 readIDs 是否包含 userID
            } else if (filter.isRead === 'unread') {
              queryStr2 += ' AND NOT JSON_CONTAINS(n.readIDs, ?)';
              queryParams2.push(JSON.stringify([userID]));  // 检查 readIDs 是否不包含 userID
            }
          }
          if (filter.location) {
            queryStr2 += ' AND n.location = ?';
            queryParams2.push(filter.location);
          }
          if (filter.startTime && filter.endTime) {
            queryStr2 += ' AND n.time BETWEEN ? AND ?';
            queryParams2.push(filter.startTime, filter.endTime);
          }

          // 添加排序和分页
          queryStr2 += ' ORDER BY n.time DESC LIMIT ? OFFSET ?';
          queryParams2.push(end - start + 1, start);  // 添加分页参数
        
          // 执行查询通知数据
          db.query(queryStr2, queryParams2, (error, results) => {
            if (error) {
              return reject(error);
            }
          
            // 将查询到的通知数据中的 deviceID 替换为对应的设备名称，并转换 readIDs 为 isRead
            const notificationWithNamesAndStatus = results.map(notification => {
              // 查找 deviceID 对应的设备名称，如果没有找到则为 null
              notification.deviceName = notification.deviceName || null;
            
              // 转换 readIDs 为 isRead
              if (notification.readIDs.includes(userID)) {
                notification.isRead = true;  // 如果 readIDs 包含 userID，设置为已读
              } else {
                notification.isRead = false;  // 如果 readIDs 不包含 userID，设置为未读
              }
            
              delete notification.readIDs;  // 删除 readIDs，因为已经转换为 isRead
            
              // 转换时间格式
              notification.time = formatDate(notification.time);

              return notification;
            });
          
            
            notification=notificationWithNamesAndStatus  // 返回处理过的通知列表

            resolve([notification,total])
          });
        }
      });
    }
  });
};

// 方法六：获取所有未读通知数量计数
function getUnreadNotificationsCountByLocation(userID) {
  return new Promise((resolve, reject) => {
    // 1. 查询未读通知总数并按等级和状态统计
    let queryStr = `
      SELECT n.location, n.level, COUNT(*) AS count
      FROM notifications n
      WHERE NOT JSON_CONTAINS(n.readIDs, ?)
      GROUP BY n.location, n.level
    `;
    const queryParams = [JSON.stringify([userID])];  // 检查 readIDs 是否不包含 userID

    // 执行查询
    db.query(queryStr, queryParams, (error, results) => {
      if (error) {
        return reject(error);
      }

      // 2. 格式化结果，按 location 和 level 进行分类
      const formattedResults = {};

      results.forEach(row => {
        // 如果 location 没有在结果中，初始化它
        if (!formattedResults[row.location]) {
          formattedResults[row.location] = {         
            error: 0,
            warning: 0,
            success: 0,
            normal: 0,
            total:0, 
          };
        }

        // 根据 status 更新对应的 count
        if (row.level === 'error') {
          formattedResults[row.location].error = row.count;
        } else if (row.level === 'success') {
          formattedResults[row.location].success = row.count;
        }
      });

      // 3. 返回按建筑和状态分类的统计结果
      resolve(formattedResults);
    });
  });
}


// 格式化日期格式：2025-02-14T05:51:06.000Z -> yyyy/mm/dd, hh:mm:ss
const formatDate = (dateString) => {
  const date = new Date(dateString);  // 转换为 Date 对象
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');  // 月份是从0开始的，所以加1
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}/${month}/${day}, ${hours}:${minutes}:${seconds}`;
};
module.exports = {
  writeNotification,
  markAsRead,
  markNotificationsAsRead,
  getUnreadNotificationsCountByLevel,
  getNotificationsByQuery,
  getUnreadNotificationsCountByLocation,
};
