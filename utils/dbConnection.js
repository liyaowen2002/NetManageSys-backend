const mysql = require('mysql2')

const connection = mysql.createConnection({
    host:'localhost',
    user:'netManageSysBackend',
    password:'test',
    database:'netManageSys',
    port:3306
})

module.exports=connection