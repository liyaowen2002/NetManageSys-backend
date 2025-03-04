const snmp = require('snmp-native');
const db = require('../utils/dbConnection'); // 数据库模块
const global = require('../global');
const { broadcastMsg } = require('../api/ws/notification');
const {sendSNMPRequest} = require('../utils/SNMP_request');
const { writeNotification } = require('./notificationManage');
const oids = [
  {
    oid:'.1.3.6.1.2.1.1.5.0',
    key:'name',
    way:'get',
    resultType:'default'
  },
  {
    oid:'.1.3.6.1.2.1.1.6.0',
    key:'location',
    way:'get',
    resultType:'default'
  }
]
let deviceStatus = {}; // 存储设备状态

// 异步 SNMP 检查设备是否在线
async function isDeviceOnline(ip) {
  return new Promise((resolve) => {
    const session = new snmp.Session({ host: ip, port: global.SNMP_config.port, community: global.SNMP_config.community });
    session.get({ oid: global.SNMP_config.test_oid }, (error, varbinds) => {
      session.close();
      if (error || varbinds.length === 0) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

// 初始化设备列表和在线状态
async function initializeDevices() {
  console.log('来自deviceMonitor：初始化设备列表...');
  deviceStatus = {}
  return new Promise((resolve, reject) => {
    db.query('SELECT id, name, ip, model, location, type FROM devices', async (err, results) => {
      if (err) {
        console.error('来自deviceMonitor：数据库查询失败:', err);
        reject(err);
        return;
      }
      for (const device of results) {
        const { id, name, ip, model, location, type } = device;
        const isOnline = await isDeviceOnline(ip);
        if (isOnline) {
          // 请求一遍与库里的对比真实的name和location
          console.log(`来自deviceMonitor：设备 ${name}（${ip}）连接成功`);
          const nameAndLocation = await sendSNMPRequest(ip,oids)
          let isNameChange,isLocationChange = false
          // 如果name变动
          if(nameAndLocation.name!==name){
            console.log(`来自deviceMonitor：设备${ip}名称变动`)
            broadcastMsg(JSON.stringify({type:'error',msg:'设备名称变动',data:{detail:`[${name}]变更为[${nameAndLocation.name}]`}}))
            isNameChange=true
          }
          // 如果location变动
          if(nameAndLocation.location!==location){
            console.log(`来自deviceMonitor：设备${ip}位置变动`)
            broadcastMsg(JSON.stringify({type:'error',msg:'设备位置变动',data:{detail:`[${location}]变更为[${nameAndLocation.location}]`}}))
            isLocationChange=true
          }
          if(isNameChange||isLocationChange){
            // 反向更新到数据库
            deviceStatus[id] = { name:nameAndLocation.name, status: 'online', model, ip, location:nameAndLocation.location, type };
            const sql = `
              UPDATE devices SET 
                name = ?,
                location = ?
              WHERE 
                id = ?`
            db.query(sql,[nameAndLocation.name,nameAndLocation.location,id],(err, results) => {
              if (err) {
                throw new Error('数据更新失败:', err)
              }
            })
          }else{
            deviceStatus[id] = { name, status: 'online', model, ip, location, type };
          }
        } else {
          console.error(`来自deviceMonitor：设备 ${name}（${ip}）连接失败`);
          deviceStatus[id] = { name, status: 'offline', model, ip, location, type };
        }
      }
      console.log('来自deviceMonitor：初始化设备列表完成');
      resolve();
    });
  });
}

// 心跳检测所有设备的状态
async function heartbeatCheck() {
  for (const deviceId of Object.keys(deviceStatus)) {
    const device = deviceStatus[deviceId];
    const { name, ip } = device;

    const isOnline = await isDeviceOnline(ip);
    if (isOnline) {
      if (deviceStatus[deviceId].status !== 'online') {
        console.log(`来自deviceMonitor：设备 ${name}（${ip}）上线`);
        deviceStatus[deviceId].status = 'online';
        const detail = `${name}（${ip}）上线`
        broadcastMsg(JSON.stringify({type:'success',msg:'设备状态改变',data:{detail}}))
        writeNotification(detail,'success',deviceId,deviceStatus[deviceId].location)
      }
    } else {
      // console.log(deviceStatus)
      if (deviceStatus[deviceId].status !== 'offline') {
        console.log(`来自deviceMonitor：设备 ${name}（${ip}）掉线`);
        deviceStatus[deviceId].status = 'offline';
        const detail = `${name}（${ip}）下线`
        broadcastMsg(JSON.stringify({type:'success',msg:'设备状态改变',data:{detail}}))
        writeNotification(detail,'error',deviceId,deviceStatus[deviceId].location)
      }
    }
  }
}
async function updateDeviceStatusManually(id, target, value) {
  // 根据 target 执行数据库更新
  let sql;
  try {
    // 更新 deviceStatus
    switch(target) {
      case 'name':
        sql = `
          UPDATE devices SET 
            name = ? 
          WHERE 
            id = ?
        `;
        await new Promise((resolve, reject) => {
          db.query(sql, [value, id], (err, results) => {
            if (err) {
              reject(new Error('数据更新失败: ' + err));
            } else {
              resolve(results);
            }
          });
        });

        deviceStatus[id].name = value;
        break;

      case 'location':
        sql = `
          UPDATE devices SET 
            location = ? 
          WHERE 
            id = ?
        `;
        await new Promise((resolve, reject) => {
          db.query(sql, [value, id], (err, results) => {
            if (err) {
              reject(new Error('数据更新失败: ' + err));
            } else {
              resolve(results);
            }
          });
        });

        deviceStatus[id].location = value;
        break;

      default:
        // 默认分支，不执行 SQL 更新
        console.log(`不支持的更新目标: ${target}`);
        return; // 不做任何操作，直接返回
    }

    console.log('设备状态更新成功');
    
  } catch (error) {
    console.error(error);
  }
}

// 启动初始化和心跳检测
async function startMonitoring() {
  await initializeDevices();
  setInterval(async () => {
    await heartbeatCheck();
  }, global.SNMP_config.heartbeat_interval);
}

// 导出模块
module.exports = {
  startMonitoring,       // 启动设备监控
  initializeDevices, // 立即更新所有设备状态
  getDeviceStatus: () => deviceStatus, // 获取设备状态
  updateDeviceStatusManually //手动更新对应的数据
};
