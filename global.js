const SNMP_config = {
    community:'NetManageSys',
    port:161,
    heartbeat_interval:5000,// 每5秒检查一次
    test_oid:'.1.3.6.1.2.1.1.3.0',//检测设备是否在线的oid
}
const SSH_config = {
    username:'NetManageSys',
    password:'@administrator',
    port:22
}
const accout_config = {
    tokenSecret:'secret'
}
module.exports = {SNMP_config,SSH_config,accout_config}