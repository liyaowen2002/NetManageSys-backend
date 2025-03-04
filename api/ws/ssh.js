const uuid = require('uuid');
const { Client } = require('ssh2');
const {getDeviceStatus} = require('../../utils/deviceMonitor')
const global = require('../../global')
// ws路由

// 前端发type:terminal,data:base64
// 前端发type:resize,data:rows,cols
// 后端发type:output,data:base64
// 后端发type:error,message:error
const sshWs = (app) => {
    const clients = {};
    
    app.ws('/ssh', async (ws, req) => {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const deviceStatus = await getDeviceStatus()[urlParams.get('id')]
        console.log(deviceStatus)

        const sshClient = new Client(); // 创建 SSH 客户端实例
        // WebSocket
        ws.on('open', () => {
            console.log('来自ssh.js：WebSocket 连接成功');
        });

        // ssh
        // 连接就绪
        sshClient.on('ready', () => {
            console.log('来自ssh.js：SSH 连接已建立');
            sshClient.shell((err, stream) => {
                if (err) {
                    ws.send(JSON.stringify({ type: 'error', message: err.message }));
                    return;
                }

                // 关闭ssh流
                stream.on('close', () => {
                    console.log('来自ssh.js：SSH 流和Ws连接关闭');
                    ws.send(JSON.stringify({ type: 'error', message: 'SSH连接关闭' }));
                    sshClient.end(); // 关闭 SSH 连接
                    ws.close();
                });

                // 关闭ws连接
                ws.on('close', () => {
                    sshClient.end(); // 关闭 SSH 连接
                });

                // 收到ssh数据就发给ws客户端
                stream.on('data', (data) => {
                    const base64Data = data.toString('base64');
                    ws.send(JSON.stringify({ type: 'output', data: base64Data }));
                });

                // 收到ws数据就发给ssh流
                ws.on('message', (message) => {
                    const parsedMessage = JSON.parse(message);
                    switch (parsedMessage.type) {
                        case 'terminal':
                            const base64Data = parsedMessage.data.base64;
                            const data = Buffer.from(base64Data, 'base64').toString(); // 解码输入数据
                            stream.write(data);
                            break;
                        case 'resize':
                            const { rows, cols } = parsedMessage.data;
                            stream.setWindow(rows, cols);
                            break;
                    }
                });
            });
        });

        // 连接错误
        sshClient.on('error', (err) => {
            console.log('来自ssh.js：SSH 错误:', err);
            ws.send(JSON.stringify({ type: 'error', message: 'SSH连接错误' }));
            ws.close();
        });

        // 建立连接
        sshClient.connect({
            host: deviceStatus.ip, // SSH 服务器地址
            port: global.SSH_config.port,                // 默认 SSH 端口
            username: global.SSH_config.username, // SSH 用户名
            password: global.SSH_config.password, // SSH 密码或使用私钥认证
        });
    });
}


module.exports = {sshWs}