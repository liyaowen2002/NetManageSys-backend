const express = require('express')
const app=express()
const jwt = require('jsonwebtoken')

const setupTimestamp = Date.now()

const expressWs = require('express-ws');
let wss = null;  // WebSocket 服务实例
const wsInstance = expressWs(app);
wss = wsInstance.getWss();  // 获取 WebSocket 服务器实例


// 添加通知的ws
const { notificationWs } = require('./api/ws/notification');
notificationWs(app);

// 添加ssh的ws
const { sshWs } = require('./api/ws/ssh');
sshWs(app);

// 启动设备监控
const { startMonitoring } = require('./utils/deviceMonitor'); // 引入 deviceMonitor.js
startMonitoring()
  .then(() => {
    console.log('来自app.js：设备监控已启动');
  })
  .catch((err) => {
    console.error('来自app.js：设备监控启动失败:', err);
  });

// const {startListeningTrap} = require('./utils/SNMP_request')
// startListeningTrap()
//////////////////////////////////中间件

// 处理跨域问题
const cors = require('cors')
app.use(cors())

// json化所有请求的载荷
app.use(express.json())

//////////////////////////////////路由

// 登录，放在token校验前面，不需要校验
const loginRouter = require('./api/http/login')
app.use('/login',loginRouter)

// 每次请求都校验一次token
app.use((req,res,next)=>{
  //  如果是ws请求直接放行不做校验
  if (req.headers['upgrade'] !== 'websocket') {
    const token = req.headers["authorization"]?.split(" ")[1]
    
    if(!token){
      return res.status(401).json({type:'error',msg:"请登录"})
    }

    try{
      jwt.verify(token,'secret')
      next()
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        // token过期时的处理
        return res.status(401).json({ type: 'error', msg: '登录过期' });
      } else {
        // 其他错误处理
        return res.status(401).json({ type: 'error', msg: '无效的Token' });
      }
    }
  }else{
    next()
  }
})

// 其他路由放token校验后面

// 用户回到网页时校验一次token，并返回设备信息
app.use('/initWhenBack',(req,res,next)=>{
  return res.status(200).json({
    type:'success',
    msg:'欢迎回来',
  })
})

// 用户回到网页时校验一次token，并返回设备信息
app.use('/getSetupTimestamp',(req,res,next)=>{
  return res.status(200).json({
    type:'success',
    msg:'获取成功',
    data:{
      setupTimestamp
    }
  })
})

// 设备管理
const devicesManageRouter = require('./api/http/devicesManage')
app.use('/devicesManage',devicesManageRouter)

// 设备配置
const deviceConfigRouter = require('./api/http/deviceConfig')
app.use('/deviceConfig',deviceConfigRouter)

// 通知管理
const notificationRouter = require('./api/http/notification')
app.use('/notification',notificationRouter)


app.listen(5200,()=>{
    console.log("来自app.js：开始监听5200端口")
})