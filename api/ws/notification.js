const jwt = require('jsonwebtoken')

let clients = {};  // 存储客户端信息，使用 id 作为键，存储 WebSocket 实例

// 初始化 WebSocket 服务
const notificationWs = (app) => {

  // 后端处理 WebSocket 连接
  app.ws('/notification', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const clientId = urlParams.get('clientId'); // 从 URL 参数获取 clientId

    // 如果没有ClientID
    if (!clientId) {
      console.log("来自notification：没有传递 clientId，断开连接");
      ws.close(); // 如果没有 clientId，断开连接
      return;
    }
  
    // ClientID校验
    try{
      jwt.verify(clientId,'secret')
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        console.log("来自notification：clientId过期");
      } else {
        console.log("来自notification：clientId检验失败",error);
      }
      ws.close();
      return
    }

    // 通过验证
    console.log(`来自notification：新的 WebSocket 客户端连接，ID: ${clientId}`);
    clients[clientId] = ws; // 使用传递的 clientId 存储 WebSocket 客户端实例
  
    // 监听消息
    ws.on('message', (msg) => {
      console.log(`来自notification：收到客户端（${clientId}）的消息: ${msg}`);
    });
  
    // 监听断开连接
    ws.on('close', () => {
      delete clients[clientId]; // 断开连接时移除客户端
      console.log(`来自notification：客户端（${clientId}）断开连接`);
    });
  });
};



// 向特定客户端发送消息
const sendMessageToClient = (clientId, message) => {
  const client = clients[clientId];
  if (!client) {
    console.log(`来自notification：没有找到 ID 为 ${clientId} 的客户端`);
    return;
  }

  if (client.readyState === 1) { // 1 表示连接处于开放状态
    client.send(message);
    console.log(`来自notification：向客户端（${clientId}）发送消息: ${message}`);
  } else {
    console.log(`来自notification：客户端（${clientId}）的连接未开放，无法发送消息`);
  }
};

// 向所有客户端发送消息（如果你依然需要广播）
const broadcastMsg = (message) => {
  for (let clientId in clients) {
    const client = clients[clientId];
    if (client.readyState === 1) { // 1 表示连接处于开放状态
      client.send(message);
    }
  }
};

module.exports = {
  notificationWs,
  sendMessageToClient,  // 新增的函数：向指定客户端发送消息
  broadcastMsg
};
