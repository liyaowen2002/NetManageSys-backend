const express = require("express");
const jwt = require("jsonwebtoken");
const snmp = require("snmp-native");
const router = express.Router();
const global = require('../../global')
const db = require('../../utils/dbConnection'); // 数据库模块
const { initializeDevices,getDeviceStatus } = require('../../utils/deviceMonitor'); // 引入 deviceMonitor.js
const {sendSNMPRequest} = require('../../utils/SNMP_request')


const SECRET = "your_jwt_secret_key";

// 生成随机 Token
function generateToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: "10m" });
}

// 检查数据库是否有重复 IP
function checkDuplicateIP(ip) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT COUNT(*) AS count FROM devices WHERE ip = ?';
    db.query(query, [ip], (err, results) => {
      if (err) {
        reject(new Error('数据库查询失败'));
      } else {
        resolve(results[0].count > 0); // 如果 count > 0，则表示有重复
      }
    });
  });
}



// 添加设备请求
router.post("/addDevice", async (req, res) => {
  const { ip } = req.body;

  if (!ip) return res.json({ code:400,msg: "缺少 IP 地址参数" });

  try {
    const isDuplicate = await checkDuplicateIP(ip);
    if(isDuplicate) {
      return res.status(200).json({ type:'error',msg:'设备已存在' });
    }else{
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
        },
        {
          oid:'.1.3.6.1.2.1.47.1.1.1.1.2',
          key:'boardDescription',
          way:'getSubtree',
          resultType:'default'
        }
      ]
      const deviceInfo = await sendSNMPRequest(ip,oids);
      const boardIndex = Object.keys(deviceInfo.boardDescription).find(key => deviceInfo.boardDescription[key] === 'Board')
      delete deviceInfo.boardDescription
      const boardOids = [
        {
          oid:`.1.3.6.1.2.1.47.1.1.1.1.13.${boardIndex}`,
          key:'model',
          way:'get',
          resultType:'default'
        },
        {
          oid:`.1.3.6.1.2.1.47.1.1.1.1.12.${boardIndex}`,
          key:'manufacturer',
          way:'get',
          resultType:'default'
        }
      ]
      const boardInfo = await sendSNMPRequest(ip,boardOids)

      const token = generateToken({ ip });
      return res.status(200).json({ type:'success',msg:'连接成功',data:{...deviceInfo,...boardInfo, token} });
    }
  } catch (error) {
    console.log('来自devicesManage：',error)
    res.status(500).json({ type:'error',msg:'连接失败',data:{error} });
  }
});

// 确认添加设备请求
router.post("/addConfirm", (req, res) => {
  const { model, name, location, ip, token, type } = req.body;

  // 校验 Token
  try {
    jwt.verify(token, SECRET);
  } catch {
    return res.status(400).json({ type:'error',msg: "Token 校验失败" });
  }

  try{
    const sql = `
      INSERT INTO devices (model, name, location, ip, type)
      VALUES (?, ?, ?, ?, ?)
    `;
    // 执行插入操作
    db.query(
      sql, 
      [model, name, location, ip, type], 
      async (err, results) => {
        if (err) {
          throw new Error('数据插入失败:', err)
        }
        await initializeDevices()
        return res.status(200).json({ type:'success',msg: "设备添加成功" });
      }
    );
  } catch (error) {
    console.log('来自devicesManage：',error)
    res.status(500).json({ type:'error',msg:'添加失败',data:{error} });
  }
});

// 获取最新设备数据
router.get("/getLatestDevicesList",(req,res)=>{
  res.status(200).json({ type:'success',msg:'获取成功',data:{devicesList:getDeviceStatus()} });
})

// 单个移除设备
router.delete("/removeDevice", async (req, res) => {
  const { id } = req.query; // 获取请求中的 id

  if (!id) {
    return res.status(400).json({ type: 'error', msg: "必须提供设备 ID" });
  }

  try {
    // 执行删除操作
    db.query("DELETE FROM devices WHERE id = ?", [id],
      (err,results)=>{
        // 如果没有删除到任何记录，说明 ID 不存在
        if (results.affectedRows === 0) {
          return res.status(404).json({ type: 'error', msg: "设备未找到" });
        }
        // 删除成功，返回响应
        res.status(200).json({ type: 'success', msg: "设备已成功删除" });
        initializeDevices()
      }
    );
  } catch (error) {
    console.error('来自devicesManage：', error);
    res.status(500).json({ type: 'error', msg: "删除失败", data: {error} });
  }
});

// 批量移除设备
router.delete("/removeDeviceBatch", async (req, res) => {
  const { ids } = req.query; // 获取请求中的 ids，假设它是一个逗号分隔的字符串，如 '1,2,3'

  if (!ids) {
    return res.status(400).json({ type: 'error', msg: "必须提供设备 ID" });
  }

  try {
    // 将 ids 转换为数组并清洗每个值，确保它们是整数
    const idArray = ids.split(',').map(id => {
      const parsedId = parseInt(id.trim(), 10);
      if (isNaN(parsedId)) {
        throw new Error(`无效ID: ${id}`);
      }
      return parsedId;
    });

    // 动态生成占位符，根据 idArray 的长度
    const placeholders = idArray.map(() => '?').join(', ');

    // 执行批量删除操作，使用动态生成的占位符
    db.query(
      `DELETE FROM devices WHERE id IN (${placeholders})`, 
      idArray, // 传递 idArray 作为参数
      async (err,results)=>{
        if(err){
          throw new Error("数据库删除失败:", error)
        }

        // 检查 affectedRows
        if (results.affectedRows === 0) {
          return res.status(404).json({ type: 'error', msg: "没有找到匹配的设备" });
        }

        // 根据需求在这里重新初始化设备列表
        await initializeDevices();
        // 删除成功，返回响应
        res.status(200).json({ type: 'success', msg: "设备已成功删除" });

      }
    )
  } catch (error) {
    console.log('来自devicesManage：',error)
    res.status(500).json({ type: 'error', msg: "删除设备时发生错误", data: {error} });
  }
});

// 有bug，直接调用initializeDevices会将列表置为空对象，定时的心跳检测此时索引为空会奔溃
// 先不要这个功能了
// router.get("/syncInfo", async (req, res) => {
//   try {
//     await initializeDevices()
//     return res.status(200).json({ type: 'success', msg: "设备信息同步完成" })
//   }
//   catch(err) {
//     console.log('来自devicesManage：',error)
//     return res.status(500).json({ type: 'error', msg: "设备信息同步失败" })
//   }
// })





module.exports = router;
