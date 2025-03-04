const express = require('express')
const router = express.Router()
const {getDeviceStatus, updateDeviceStatusManually} = require('../../utils/deviceMonitor')
const {getInterfaceMap, formatSpeed,getRouteMap,getHardwareMap} = require('../../utils/typeMapper')
const {sendSNMPRequest, setSingleSNMPRequest} = require('../../utils/SNMP_request')
const db = require('../../utils/dbConnection'); // 数据库模块

// 获取设备静态信息的路由处理函数
router.get('/staticInfo',async (req,res)=>{
    // 从请求参数中获取设备ID
    const {id} = req.query

    // 检查是否提供了设备ID
    if(!id) return res.status(400).json({
        type:'error',
        msg:'缺少ID',
    })

    // 获取设备状态信息
    const deviceStatus = getDeviceStatus()[id]
    // 检查设备是否存在
    if(deviceStatus===undefined) 
      return res.status(400).json({
        type:'error',
        msg:'设备不存在',
    })
    // 检查设备是否在线
    if(deviceStatus.status!=='online') 
      return res.status(400).json({
      type:'error',
      msg:'设备不在线',
    })

    const oids=[
      {
          oid:'.1.3.6.1.2.1.1.1.0',
          key:'description',
          way:'get',
          resultType:'default'
      },
      {
          oid:'.1.3.6.1.2.1.1.3.0',
          key:'uptime',
          way:'get',
          resultType:'default'
      },
      {
          oid:'.1.3.6.1.2.1.1.4.0',
          key:'contact',
          way:'get',
          resultType:'default'
      },
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
    // 获取设备的静态信息
    const deviceInfo = await sendSNMPRequest(deviceStatus.ip,oids)
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
    const boardInfo = await sendSNMPRequest(deviceStatus.ip,boardOids)

    // 获取备注
    const sql = 'SELECT note FROM devices where id = ?'
    db.query(sql,[id],(err, results) => {
      return res.status(200).json({
        type:'success',
        msg:'获取设备信息成功',
        data:{
          ...deviceInfo,
          ...boardInfo,
          note:results[0].note,
          ip:deviceStatus.ip,
        }
      })
    })
    // 返回成功响应,包含设备信息
})

// 获取硬件信息
router.get('/hardware',async (req,res)=>{
  const {id} = req.query

  if(!id) return res.status(400).json({
      type:'error',
      msg:'缺少ID',
  })

  const deviceStatus = getDeviceStatus()[id]
  if(deviceStatus===undefined||deviceStatus.status!=='online') 
    return res.status(400).json({
      type:'error',
      msg:'设备不存在',
  })

  const oids=[
    // 名称
    {
      oid:'.1.3.6.1.2.1.47.1.1.1.1.7',
      key:'name',
      way:'getSubtree',
      resultType:'default'
  },
    // 描述
    {
        oid:'.1.3.6.1.2.1.47.1.1.1.1.2',
        key:'description',
        way:'getSubtree',
        resultType:'default'
    },
    // 类别
    {
        oid:'.1.3.6.1.2.1.47.1.1.1.1.5',
        key:'class',
        way:'getSubtree',
        resultType:'default'
    },
    // 硬件版本
    {
      oid:'.1.3.6.1.2.1.47.1.1.1.1.8',
      key:'hardwareRev',
      way:'getSubtree',
      resultType:'default'
  },
    // 固件版本
  {
    oid:'.1.3.6.1.2.1.47.1.1.1.1.9',
    key:'firmwareRev',
    way:'getSubtree',
    resultType:'default'
},
    // 软件版本
  {
    oid:'.1.3.6.1.2.1.47.1.1.1.1.10',
    key:'softwareRev',
    way:'getSubtree',
    resultType:'default'
},
    // 序列号
    {
      oid:'.1.3.6.1.2.1.47.1.1.1.1.11',
      key:'serialNumber',
      way:'getSubtree',
      resultType:'default'
  },
  // 制造商
  {
    oid:'.1.3.6.1.2.1.47.1.1.1.1.12',
    key:'manufacturer',
    way:'getSubtree',
    resultType:'default'
  },
  // 型号
  {
    oid:'.1.3.6.1.2.1.47.1.1.1.1.13',
    key:'model',
    way:'getSubtree',
    resultType:'default'
  },
]
  const deviceInfo = await sendSNMPRequest(deviceStatus.ip,oids)
  const hardwareTable = Object.keys(deviceInfo.name).map(key => ({
    index: key,
    name: deviceInfo.name[key],
    description: deviceInfo.description[key],
    class: getHardwareMap('class',deviceInfo.class[key]),
    hardwareRev: deviceInfo.hardwareRev[key],
    firmwareRev: deviceInfo.firmwareRev[key],
    softwareRev: deviceInfo.softwareRev[key],
    serialNumber: deviceInfo.serialNumber[key],
    manufacturer: deviceInfo.manufacturer[key],
    model: deviceInfo.model[key],
  }))
  deviceInfo.hardwareTable = hardwareTable
  delete deviceInfo.name
  delete deviceInfo.description
  delete deviceInfo.class
  delete deviceInfo.hardwareRev
  delete deviceInfo.firmwareRev
  delete deviceInfo.softwareRev
  delete deviceInfo.serialNumber
  delete deviceInfo.manufacturer
  delete deviceInfo.model

  return res.status(200).json({
      type:'success',
      msg:'获取设备信息成功',
      data:{
        ...deviceInfo,
        ip:deviceStatus.ip,
      }
  })
})

// 获取接口信息
router.get('/interface',async (req,res)=>{
  const {id} = req.query

  if(!id) return res.status(400).json({
      type:'error',
      msg:'缺少ID',
  })

  const deviceStatus = getDeviceStatus()[id]
  if(deviceStatus===undefined||deviceStatus.status!=='online') 
    return res.status(400).json({
      type:'error',
      msg:'设备不存在',
  })

  const oids=[
    {
        oid:'.1.3.6.1.2.1.2.2.1.1',
        key:'index',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.2.2.1.2',
        key:'description',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.2.2.1.3',
        key:'type',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.2.2.1.4',
        key:'MTU',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.2.2.1.5',
        key:'speed',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.2.2.1.6',
        key:'physicalAddress',
        way:'getSubtree',
        resultType:'octetString'
    },
    // 接口状态
    {
        oid:'.1.3.6.1.2.1.2.2.1.7',
        key:'operStatus',
        way:'getSubtree',
        resultType:'default'
    }
]
  const deviceInfo = await sendSNMPRequest(deviceStatus.ip,oids)
  const interfaceTable = Object.keys(deviceInfo.index).map(key => ({
    index: key,
    description: deviceInfo.description[key],
    type: getInterfaceMap('type',deviceInfo.type[key]), 
    MTU: deviceInfo.MTU[key],
    speed: formatSpeed(deviceInfo.speed[key]),
    physicalAddress: (deviceInfo.physicalAddress[key].match(/.{2}/g)?.join(':') || deviceInfo.physicalAddress[key]).toUpperCase(),
    operStatus: getInterfaceMap('operStatus',deviceInfo.operStatus[key])
  }))
  deviceInfo.interfaceTable = interfaceTable
  delete deviceInfo.index
  delete deviceInfo.description
  delete deviceInfo.type
  delete deviceInfo.MTU
  delete deviceInfo.speed
  delete deviceInfo.physicalAddress
  delete deviceInfo.operStatus

  return res.status(200).json({
      type:'success',
      msg:'获取设备信息成功',
      data:{
        ...deviceInfo,
        ip:deviceStatus.ip,
      }
  })
})

// 获取路由信息
router.get('/route',async (req,res)=>{
  const {id} = req.query

  if(!id) return res.status(400).json({
      type:'error',
      msg:'缺少ID',
  })

  const deviceStatus = getDeviceStatus()[id]
  if(deviceStatus===undefined||deviceStatus.status!=='online') 
    return res.status(400).json({
      type:'error',
      msg:'设备不存在',
  })

  const oids=[
    {
        oid:'.1.3.6.1.2.1.4.21.1.1',
        key:'destination',
        way:'getSubtree',
        resultType:'array'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.2',
        key:'interfaceIndex',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.7',
        key:'nextHop',
        way:'getSubtree',
        resultType:'array'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.8',
        key:'type',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.9',
        key:'protocol',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.10',
        key:'age',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.4.21.1.11',
        key:'mask',
        way:'getSubtree',
        resultType:'array'
    },

]
  const deviceInfo = await sendSNMPRequest(deviceStatus.ip,oids)
  const routeTable = Object.keys(deviceInfo.destination).map(key => ({
    destination: deviceInfo.destination[key],
    interfaceIndex: deviceInfo.interfaceIndex[key],
    nextHop: deviceInfo.nextHop[key],
    type: getRouteMap('type',deviceInfo.type[key]),
    protocol: getRouteMap('protocol',deviceInfo.protocol[key]),
    age: deviceInfo.age[key],
    mask: deviceInfo.mask[key],
  }))
  deviceInfo.routeTable = routeTable
  delete deviceInfo.destination
  delete deviceInfo.interfaceIndex
  delete deviceInfo.nextHop
  delete deviceInfo.type
  delete deviceInfo.protocol
  delete deviceInfo.age
  delete deviceInfo.mask

  return res.status(200).json({
      type:'success',
      msg:'获取设备信息成功',
      data:{
        ...deviceInfo,
        ip:deviceStatus.ip,
      }
  })
})

// 获取arp信息
router.get('/arp',async (req,res)=>{
  const {id} = req.query

  if(!id) return res.status(400).json({
      type:'error',
      msg:'缺少ID',
  })

  const deviceStatus = getDeviceStatus()[id]
  if(deviceStatus===undefined||deviceStatus.status!=='online') 
    return res.status(400).json({
      type:'error',
      msg:'设备不存在',
  })

  const oids=[
    {
        oid:'.1.3.6.1.2.1.3.1.1.1',
        key:'interfaceIndex',
        way:'getSubtree',
        resultType:'default'
    },
    {
        oid:'.1.3.6.1.2.1.3.1.1.2',
        key:'physicalAddress',
        way:'getSubtree',
        resultType:'octetString'
    },
    {
        oid:'.1.3.6.1.2.1.3.1.1.3',
        key:'netAddress',
        way:'getSubtree',
        resultType:'array'
    },
]
  const deviceInfo = await sendSNMPRequest(deviceStatus.ip,oids)
  const arpTable = Object.keys(deviceInfo.interfaceIndex).map(key => ({
    interfaceIndex: deviceInfo.interfaceIndex[key],
    physicalAddress: (deviceInfo.physicalAddress[key].match(/.{2}/g)?.join(':') || deviceInfo.physicalAddress[key]).toUpperCase(),
    netAddress: deviceInfo.netAddress[key],
  }))
  deviceInfo.arpTable = arpTable
  delete deviceInfo.interfaceIndex
  delete deviceInfo.physicalAddress
  delete deviceInfo.netAddress

  return res.status(200).json({
      type:'success',
      msg:'获取设备信息成功',
      data:{
        ...deviceInfo,
        ip:deviceStatus.ip,
      }
  })
})

// 修改基础信息sys-info
router.post('/editSysInfo', async (req, res) => {
  const sysInfoEdited = req.body;
  // 检查是否提供了设备ID
  if(!sysInfoEdited.id) return res.status(400).json({
    type:'error',
    msg:'缺少ID',
  })

  // 获取设备状态信息
  const deviceStatus = getDeviceStatus()[sysInfoEdited.id]
  // 检查设备是否存在
  if(deviceStatus===undefined) 
    return res.status(400).json({
      type:'error',
      msg:'设备不存在',
  })

  if(sysInfoEdited.key==='note'){
    try{
      const sql = 'UPDATE devices SET note = ? WHERE id = ?'
      db.query(sql,[sysInfoEdited.value,sysInfoEdited.id],(err, results) => {
        if (err) {
          return res.status(500).json({
            type: 'error',
            msg: '设备信息更新失败',
            data:{err}
          });
        }
        return res.status(200).json({
          type: 'success',
          msg: '设备信息更新成功',
        });
      })
    }catch(error){
      console.log('来自deviceConfig.js：',error)
      return res.status(500).json({
        type: 'error',
        msg: '设备信息更新失败',
        data:{error}
      });
    }

  }else{
    // 预设的 OID 信息
    const oidsPreset = {
      'name': {
        oid: '.1.3.6.1.2.1.1.5.0',
        type: 4
      },
      'location': {
        oid: '.1.3.6.1.2.1.1.6.0',
        type: 4
      },
      'contact': {
        oid: '.1.3.6.1.2.1.1.4.0',
        type: 4
      },
    };

    // 获取 sysInfoEdited 中的 key 对应的 OID
    const selectedOid = oidsPreset[sysInfoEdited.key];

    // 如果找到了相应的 OID，调用 setSingleSNMPRequest
    if (selectedOid) {
      try {
        // 通过 setSingleSNMPRequest 调用 SNMP 请求
        await setSingleSNMPRequest(
          deviceStatus.ip,
          selectedOid.oid,
          sysInfoEdited.value,
          selectedOid.type
        );
        if(sysInfoEdited.key==='name'){
          await updateDeviceStatusManually(sysInfoEdited.id,'name',sysInfoEdited.value)
        }
        if(sysInfoEdited.key==='location'){
          await updateDeviceStatusManually(sysInfoEdited.id,'location',sysInfoEdited.value)
        }

        // 如果成功，返回响应
        res.status(200).json({
          type: 'success',
          msg: '设备信息更新成功',
        });
      } catch (error) {
        console.error(error);
        // 如果失败，返回错误响应
        res.status(500).json({
          type: 'error',
          msg: '设备信息更新失败',
          data:{error}
        });
      }
    } else {
      res.status(400).json({
        type: 'error',
        msg: '无效的设备信息键'
      });
    }
  }
});

module.exports = router