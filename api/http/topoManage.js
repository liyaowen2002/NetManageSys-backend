const express = require('express');
const router = express.Router();
const db = require('../../utils/dbConnection'); // 数据库连接
const { writeNotification } = require('../../utils/notificationManage');
const jwt = require('jsonwebtoken')

router.post('/updateTopo', async (req, res) => {
    const topoData = req.body;
    const decoded = jwt.verify(req.headers["authorization"]?.split(" ")[1], 'secret');  // 替换为你实际使用的密钥
    if (!Array.isArray(topoData)) {
        return res.status(400).json({ type: 'error', msg: '无效的数据格式，需要为数组' });
    }

    try {
        // 1. 获取所有新数据的 ID
        const newIds = topoData.map(item => item.id);

        // 2. 先插入或更新新数据
        const values = topoData.map(item => ([
            item.id || null,
            item.type || null,
            item.label || null,
            item.x || null,
            item.y || null,
            item.from || null,
            item.to || null,
        ]));

        const insertSql = `
            INSERT INTO topo (id, type, label, x, y, \`from\`, \`to\`)
            VALUES ?
            ON DUPLICATE KEY UPDATE 
                type = VALUES(type), 
                label = VALUES(label), 
                x = VALUES(x), 
                y = VALUES(y), 
                \`from\` = VALUES(\`from\`), 
                \`to\` = VALUES(\`to\`)
        `;

        db.query(insertSql, [values], (err, result) => {
            if (err) {
                return res.status(500).json({ type: 'error', msg: '服务器错误，无法保存拓扑数据', data: { err } });
            }

            // 3. 删除数据库中不在新数据 ID 列表中的旧数据
            if (newIds.length > 0) {
                const deleteSql = `DELETE FROM topo WHERE id NOT IN (?)`;
                db.query(deleteSql, [newIds], (deleteErr, deleteResult) => {
                    if (deleteErr) {
                        return res.status(500).json({ type: 'error', msg: '删除旧数据失败', data: { deleteErr } });
                    }
                    writeNotification('拓扑数据更新并清理掉了旧数据','normal',null,null,`${decoded.nickName}(${decoded.userName})`)
                    return res.json({ type: 'success', msg: '拓扑数据已成功更新并清理旧数据' });
                });
            } else {
                writeNotification('拓扑数据更新','normal',null,null,`${decoded.nickName}(${decoded.userName})`)
                return res.json({ type: 'success', msg: '拓扑数据已成功更新（没有旧数据需要删除）' });
            }
        });

    } catch (error) {
        console.error('数据库写入错误:', error);
        res.status(500).json({ type: 'error', message: '服务器错误，无法保存拓扑数据', data: { error } });
    }
});

router.get('/getTopo', async (req, res) => {
    try {
        // 查询所有拓扑数据
        const sql = 'SELECT * FROM topo';
        db.query(sql, (err, results) => {
            if (err) {
                console.error('数据库查询错误:', err);
                return res.status(500).json({ type: 'error', msg: '服务器错误，无法获取拓扑数据', data: { err } });
            }

            // 返回查询结果
            return res.json({ type: 'success', msg: '获取成功', data: results });
        });
    } catch (error) {
        console.error('服务器错误:', error);
        res.status(500).json({ type: 'error', msg: '服务器错误，无法获取拓扑数据', data: { error } });
    }
});

router.post('/bindBuilding', async (req, res) => {
    const { id, bindBuilding } = req.body;

    if (!id || !bindBuilding) {
        return res.status(400).json({ type: 'error', msg: '缺少必要参数: id 或 bindBuilding' });
    }

    try {
        // 更新 topo 表中的 bindBuildingNameENG 字段
        const updateSql = `
            UPDATE topo
            SET bindBuildingNameENG = ?
            WHERE id = ?
        `;

        db.query(updateSql, [bindBuilding, id], (err, result) => {
            if (err) {
                console.error('数据库更新错误:', err);
                return res.status(500).json({ type: 'error', msg: '服务器错误，无法绑定建筑', data: { err } });
            }

            if (result.affectedRows === 0) {
                // 如果没有找到对应的记录
                return res.status(404).json({ type: 'error', msg: '未找到对应的拓扑数据', data: { id } });
            }

            // 更新成功
            writeNotification('拓扑数据绑定建筑成功','normal',null,null)
            return res.json({ type: 'success', msg: '绑定建筑成功', data: { id, bindBuilding } });
        });
    } catch (error) {
        console.error('服务器错误:', error);
        res.status(500).json({ type: 'error', msg: '服务器错误，无法绑定建筑', data: { error } });
    }
});

module.exports = router;