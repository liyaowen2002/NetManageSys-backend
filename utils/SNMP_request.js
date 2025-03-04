const snmp = require("snmp-native");
const global = require('../global')
// 发送SNMP请求并获取结果
async function sendSNMPRequest(ip,oids){
    const session = new snmp.Session({ host: ip,port: global.SNMP_config.port, community: global.SNMP_config.community });
    const results = {}
    
    // 使用Promise处理异步SNMP请求
    await Promise.all(oids.map(async ({ oid, key, way,resultType }) => {
      const regex = /\d+/g;
      const matches = oid.match(regex);
      const parsedOid = matches ? matches.map(num => parseInt(num, 10)) : [];
  
      return new Promise((resolve, reject) => {
        switch (way) {
          case 'get':
            session.get({ oid:parsedOid }, (error, varbinds) => {
              if (error) {
                reject(`SNMP 请求失败 (OID: ${oid})`);
                return;
              }
              results[key] = varbinds[0].value;
              resolve();
            });
            break;
          case 'getSubtree':
            session.getSubtree({ oid:parsedOid }, (error, varbinds) => {
              if (error) {
                reject(`SNMP 请求失败 (OID: ${oid})`);
                return;
              }
              results[key] = {}
              // 处理结果类型，如果是default，则直接赋值，如果是octetString，直接取valueHex
              if(resultType==="default"){
                varbinds.forEach(item => {
                  results[key][item.oid.slice(parsedOid.length).toString('.')] = item.value;
                });
              }else if(resultType==="octetString"){
                varbinds.forEach(item => {
                  results[key][item.oid.slice(parsedOid.length).toString('.')] = item.valueHex;
                });
              }else if(resultType==="array"){
                varbinds.forEach(item => {
                  results[key][item.oid.slice(parsedOid.length).toString('.')] = item.value.join('.');
                });
              }
              resolve();
            });
            break;
          default:
            reject(`不支持的请求方式: ${way}`);
            break;
        }
      });
    }));
  
    // 关闭SNMP会话
    session.close();
    return results;
  }

  async function setBatchSNMPRequest(ip, oids) {
    const session = new snmp.Session({
      host: ip,
      port: global.SNMP_config.port,
      community: global.SNMP_config.community
    });
    
    const results = {};
  
    // 使用 Promise.allSettled 来确保所有请求都能完成
    await Promise.allSettled(oids.map(async ({ oid, key, value, type }) => {
      return new Promise((resolve, reject) => {
        session.set({ oid, value, type }, function (error, varbind) {
          if (error) {
            results[key] = 'error: ' + error.message || error;  // 捕获并存储错误信息
            reject(error);  // 传递错误对象
          } else {
            results[key] = 'success';
            resolve();
          }
        });
      });
    }));
  
    // 关闭 SNMP 会话
    session.close();
    return results;
  }

  async function setSingleSNMPRequest(ip, oid, value, type) {
    const session = new snmp.Session({
      host: ip,
      port: global.SNMP_config.port,
      community: global.SNMP_config.community
    });
  
    return new Promise((resolve, reject) => {
      session.set({oid,value,type}, function (error, varbind) {
        if (error) {
          reject('error: ' + (error.message || error));  // 直接传递错误信息并拒绝
        } else {
          resolve();  // 请求成功时，直接 resolve
        }
        session.close();  // 在请求完成后关闭会话
      });
    });
  }
  

// function startListeningTrap () {
//   const dgram = require('dgram');
//   const snmp = require('snmp-native');
//   const server = dgram.createSocket('udp4');  // 使用 UDP 协议接收 Trap
  
//   const trapPort = 162;  // SNMP Trap 默认端口
//   const community = 'NetManageSys';  // Community 字符串
  
//   // 监听指定的端口
//   server.on('message', (msg, rinfo) => {
//     console.log(`Received SNMP Trap from ${rinfo.address}:${rinfo.port}`);
    
//     // 解析收到的 SNMP Trap 消息
//     const session = new snmp.Session({});
  
//     session.on('trap', (trap) => {
//       console.log('Received Trap:');
//       console.log('Community:', trap.community);
//       console.log('Trap OIDs:', trap.oids);
      
//       trap.oids.forEach((oid) => {
//         console.log(`OID: ${oid}, Value: ${trap.oids[oid]}`);
//       });
//     });
  
//     // 解码 SNMP Trap 数据
//     session.decodeTrap(msg, (err, trap) => {
//       if (err) {
//         console.error('Error decoding trap:', err);
//       } else {
//         session.emit('trap', trap);
//       }
//     });
//   });
  
//   // 绑定 UDP 端口，监听 Trap 消息
//   server.bind(trapPort, () => {
//     console.log(`Listening for SNMP Trap on port ${trapPort}`);
//   });
// }
module.exports={
    sendSNMPRequest,
    setBatchSNMPRequest,
    setSingleSNMPRequest,
    // startListeningTrap
}