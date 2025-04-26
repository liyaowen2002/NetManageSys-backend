const express = require('express')
const router = express.Router()
// 链接数据库
const db = require('../../utils/dbConnection')
// 引入token工具
const jwt = require('jsonwebtoken')


router.post('',(req,res)=>{
    const { username,password } = req.body;
    const sql = "SELECT * FROM user WHERE username = ?"
    db.query(sql,[username],(err,result)=>{
        if(err) 
            return res.status(200).json({
                type:'error',
                msg:"数据库查询失败"
            })

        if (result.length < 1) 
            return res.status(200).json({
                type:'error',
                msg:"用户不存在"
            })

        if (result[0].password !== password) {
            return res.status(200).json({
                type:'error',
                msg:"密码错误"
            });
        }
        /** 登录成功设置token值，返回给前端 **/
        const token = jwt.sign({ userID:result[0].id,role:result[0].role,userName:result[0].username,nickName:result[0].nickname }, 'secret',{expiresIn:'1d'});
        return res.status(200).json({
            type:'success',
            msg: "登录成功",
            data:{
                token,
                nickname:result[0].nickname,
                username:result[0].username,
                role:result[0].role,
            }
        });
    })
})


module.exports = router