const express = require('express');
const router = express.Router();
const { getNotificationsByQuery,markAsRead,getUnreadNotificationsCountByLevel, markNotificationsAsRead, getUnreadNotificationsCountByLocation } = require('../../utils/notificationManage');  // 导入你刚才写的数据库查询方法
const jwt = require('jsonwebtoken'); // 用于解密JWT token
// 获取通知列表的路由
router.post('/getNotifications', async (req, res) => {
    const { filter, page, pageSize } = req.body;  // 从请求体中解构筛选条件、页码和每页数量 
    // 计算 start 和 end
    const start = (page - 1) * pageSize;  // 起始索引
    const end = start + pageSize -1;  // 结束索引  
    try {
      // 解密 token 获取 userID
      const decoded = jwt.verify(req.headers["authorization"]?.split(" ")[1], 'secret');  // 替换为你实际使用的密钥
      const userID = decoded.userID;  // 获取 userID
      // 获取符合条件的通知数据
      const [notifications,total] = await getNotificationsByQuery(filter, start, end, userID); 
      // 返回数据
      return res.json({
          type: 'success',
          msg: '获取通知数据成功',
          data: {
              notifications,
              total
          }
      });
    } catch (error) {
      console.log("来自notification：",error)
      res.status(500).json({
          type: 'error',
          msg: '获取通知数据失败',
          data: {
              error
          }
      });
    }
});
  

// 路由：获取用户所有未读通知数量，并统计数量
router.get('/unreadCountByLevel', async (req, res) => {
    try {
        // 1. 验证 JWT 并获取 userID
        const decoded = jwt.verify(req.headers["authorization"]?.split(" ")[1], 'secret');  // 替换为你实际使用的密钥
        const userID = decoded.userID;  // 获取 userID

        // 2. 调用函数
        const result = await getUnreadNotificationsCountByLevel(userID);
        const result2 = await getUnreadNotificationsCountByLocation(userID)

        // 3. 返回响应
        if (result) {
            return res.json({
                type: 'success',
                msg: '查询成功',
                data:{
                    byLevel:{...result},
                    byLocation:{...result2}
                }
            });
        } else {
            return res.json({
                type: 'error',
                msg: '查询失败'
            });
        }
    } catch (error) {
        console.log("来自notification：",error)
        // 处理异常情况
        return res.status(500).json({
            type: 'error',
            msg: '查询错误',
            data:{
                error
            }
        });
    }
});



// 路由：标记一条通知为已读
router.post('/markAsRead', async (req, res) => {
    try {
        // 1. 验证 JWT 并获取 userID
        const decoded = jwt.verify(req.headers["authorization"]?.split(" ")[1], 'secret');  // 替换为你实际使用的密钥
        const userID = decoded.userID;  // 获取 userID

        // 2. 获取请求体中的 notificationID
        const { notificationID } = req.body;

        // 3. 调用 markAsRead 函数
        const result = await markAsRead(notificationID, userID);

        // 4. 根据 markAsRead 结果返回响应
        if (result) {
            return res.json({
                type: 'success',
                msg: '已标为已读'
            });
        } else {
            return res.json({
                type: 'error',
                msg: '标记失败'
            });
        }
    } catch (error) {
        console.log("来自notification：",error)
        // 处理异常情况
        return res.status(500).json({
            type: 'error',
            msg: error.message || '服务器错误'
        });
    }
});



// 路由：一键已读全部
router.post('/markAllAsRead', async (req, res) => {
    try {
        const { filter } = req.body;
        // 1. 验证 JWT 并获取 userID
        const decoded = jwt.verify(req.headers["authorization"]?.split(" ")[1], 'secret');  // 替换为你实际使用的密钥
        const userID = decoded.userID;  // 获取 userID

        // 2. 调用函数
        const result = await markNotificationsAsRead(filter,userID);

        // 3. 根据 markAsRead 结果返回响应
        if (result) {
            return res.json({
                type: 'success',
                msg: `${result}条记录全部标为已读`
            });
        } else {
            return res.json({
                type: 'error',
                msg: '标记失败'
            });
        }
    } catch (error) {
        console.log("来自notification：",error)
        // 处理异常情况
        return res.status(500).json({
            type: 'error',
            msg: '查询错误',
            data:{
                error
            }
        });
    }
});
module.exports = router;
