import * as svgCaptcha from 'svg-captcha'
import { User, Notification, Logger, Organization, Repository } from '../models'
import router from './router'
import { Model, Sequelize } from 'sequelize-typescript';
import Pagination from './utils/pagination'
import { ldapAuthorize } from './utils/ldapAuthorize'
import { QueryInclude } from '../models'
import * as md5 from 'md5'
const Op = Sequelize.Op

declare interface AccountOption {
  fullname: string;
  email: string;
  password: string;
}

const accountRegisterHandler = async function (arg: AccountOption) {
  let { fullname, email, password } = arg
  let result;
  let exists = await User.findAll({
    where: { email },
  })
  if (exists && exists.length) {
    result = {
      isOk: false,
      errMsg: '该邮件已被注册，请更换再试。',
    }
    return result
  }
  let userData = await User.create({ fullname, email, password: md5(md5(password)) })
  result = {
    id: userData.id,
    fullname: userData.fullname,
    email: userData.email,
  }
  return result;
}

const verifyAccountExisted = async function(account: string, password: string|Buffer) {
  let reg = /^[^@]{1,}@?(\w)+\.com$/; // email.indexOf('@') > -1
  const emailStr: string = reg.test(account) ? account : account + '@317hu.com'
  const data = await User.findOne({
    attributes: QueryInclude.User.attributes,
    where: {email: emailStr, password: md5(md5(password)) },
  })
  return data;
}


router.get('/app/get', async (ctx, next) => {
  let data: any = {}
  let query = ctx.query
  let hooks: any = {
    user: User,
  }
  for (let name in hooks) {
    if (!query[name]) continue
    data[name] = await hooks[name].findById(query[name], {
      attributes: { exclude: [] },
    })
  }
  ctx.body = {
    data: Object.assign({}, ctx.body && ctx.body.data, data),
  }

  return next()
})

router.get('/account/count', async (ctx) => {
  ctx.body = {
    data: await User.count(),
  }
})

router.get('/account/list', async (ctx) => {
  let where = {}
  let { name } = ctx.query
  if (name) {
    Object.assign(where, {
      [Op.or]: [
        { fullname: { $like: `%${name}%` } },
      ],
    })
  }
  let options = { where }
  let total = await User.count(options)
  let pagination = new Pagination(total, ctx.query.cursor || 1, ctx.query.limit || 10)
  ctx.body = {
    data: await User.findAll(Object.assign(options, {
      attributes: ['id', 'fullname', 'email'],
      offset: pagination.start,
      limit: pagination.limit,
      order: [
        ['id', 'DESC'],
      ],
    })),
    pagination: pagination,
  }
})

router.get('/account/info', async (ctx) => {
  ctx.body = {
    data: ctx.session.id ? await User.findById(ctx.session.id, {
      attributes: QueryInclude.User.attributes,
    }) : undefined,
  }
})

router.post('/account/login', async (ctx) => {
  let { email = '', password /* , captcha*/ } = ctx.request.body
  let result, errMsg;
  /*
  if ( email !== 'guest@317hu.com' &&  // 新增 游客模式判断：当为游客时，可为空
    // captcha !== 'guest_captcha' && // postman 调试传参
    process.env.TEST_MODE !== 'true' &&
    ((!captcha) || !ctx.session.captcha || captcha.trim().toLowerCase() !== ctx.session.captcha.toLowerCase())) {
    errMsg = '错误的验证码'
  } else {
  }
  */

  try {
    /* 内部账号 执行； */
    if (email !== 'guest@317hu.com' && process.env.TEST_MODE !== 'true') {
      let userData: any = await ldapAuthorize.login(email.replace(/@317hu\.com$/, ''), password);
      if (userData.success) {
        result = await verifyAccountExisted(email, password);
        if (result && !result.id) { // !false 情况下执行操作： 注册 ldap用户信息
          result = await accountRegisterHandler({
            fullname: userData.data.givenName,
            email: userData.data.mail,
            password: password,
          })
        }
        if (result && result.id) {
          ctx.session.id = result.id
          ctx.session.fullname = result.fullname
          ctx.session.email = result.email
          let app: any = ctx.app
          app.counter.users[result.fullname] = true
        } else {
          errMsg = '账号或密码错误，请更新后再试。' // '该邮件已被注册，请更换再试。'
        }
      } else {
        errMsg = userData.errMsg ? userData.errMsg : '抱歉，账号或密码错误？'
      }
    } else { // 游客模式 执行；
      let reg = /^[^@]{1,}@?(\w)+\.com$/; // email.indexOf('@') > -1
      const emailStr: string = reg.test(email) ? email : email + '@317hu.com'
      result = await User.findOne({
        attributes: QueryInclude.User.attributes,
        where: {email: emailStr, password: md5(md5(password)) },
      })
    }
    if (result && result.id) {
      ctx.session.id = result.id
      ctx.session.fullname = result.fullname
      ctx.session.email = result.email
      // ?
      let app: any = ctx.app
      app.counter.users[result.fullname] = true
    }
  } catch (err) {
    errMsg = err.errMsg ? err.errMsg : err; // 捕获 reject
  }
  ctx.body = {
    data: result ? result : { errMsg },
    success: true
  }
})

router.get('/captcha_data', ctx => {
  ctx.body = {
    data: JSON.stringify(ctx.session)
  }
})

router.get('/account/logout', async (ctx) => {
  let app: any = ctx.app
  delete app.counter.users[ctx.session.email]
  let id = ctx.session.id
  Object.assign(ctx.session, { id: undefined, fullname: undefined, email: undefined })
  ctx.body = {
    data: await { id },
  }
})

router.post('/account/register', async (ctx) => {
  let { fullname, email, password } = ctx.request.body
  let exists = await User.findAll({
    where: { email },
  })
  if (exists && exists.length) {
    ctx.body = {
      data: {
        isOk: false,
        errMsg: '该邮件已被注册，请更换再试。',
      },
    }
    return
  }

  // login automatically after register
  let result = await User.create({ fullname, email, password: md5(md5(password)) })

  if (result) {
    ctx.session.id = result.id
    ctx.session.fullname = result.fullname
    ctx.session.email = result.email
    let app: any = ctx.app
    app.counter.users[result.fullname] = true
  }

  ctx.body = {
    data: {
      id: result.id,
      fullname: result.fullname,
      email: result.email,
    },
  }
})

router.post('/account/update', async (ctx) => {
  const { password } = ctx.request.body
  let errMsg = ''
  let isOk = false

  if (!ctx.session || !ctx.session.id) {
    errMsg = '登陆超时'
  } else if (password.length < 6) {
    errMsg = '密码长度过短'
  } else {
    const user = await User.findById(ctx.session.id)
    user.password = md5(md5(password))
    await user.save()
    isOk = true
  }
  ctx.body = {
    data: {
      isOk,
      errMsg
    }
  }
})

router.get('/account/remove', async (ctx) => {
  if (process.env.TEST_MODE === 'true') {
    ctx.body = {
      data: await User.destroy({
        where: { id: ctx.query.id },
      }),
    }
  } else {
    ctx.body = {
      data: {
        isOk: false,
        errMsg: 'access forbidden',
      },
    }
  }
})

// TODO 2.3 账户设置
router.get('/account/setting', async (ctx) => {
  ctx.body = {
    data: {},
  }
})

router.post('/account/setting', async (ctx) => {
  ctx.body = {
    data: {},
  }
})

// TODO 2.3 账户通知
let NOTIFICATION_EXCLUDE_ATTRIBUTES: any = []
router.get('/account/notification/list', async (ctx) => {
  let total = await Notification.count()
  let pagination = new Pagination(total, ctx.query.cursor || 1, ctx.query.limit || 10)
  ctx.body = {
    data: await Notification.findAll({
      attributes: { exclude: NOTIFICATION_EXCLUDE_ATTRIBUTES },
      offset: pagination.start,
      limit: pagination.limit,
      order: [
        ['id', 'DESC'],
      ],
    }),
    pagination: pagination,
  }
})

router.get('/account/notification/unreaded', async (ctx) => {
  ctx.body = {
    data: [],
  }
})

router.post('/account/notification/unreaded', async (ctx) => {
  ctx.body = {
    data: 0,
  }
})

router.post('/account/notification/read', async (ctx) => {
  ctx.body = {
    data: 0,
  }
})

// TODO 2.3 账户日志
router.get('/account/logger', async (ctx) => {
  if (!ctx.session.id) {
    ctx.body = {
      data: {
        isOk: false,
        errMsg: 'not login'
      }
    }
    return
  }
  let auth = await User.findById(ctx.session.id)
  let repositories: Model<Repository>[] = [...(<Model<Repository>[]>await auth.$get('ownedRepositories')), ...(<Model<Repository>[]>await auth.$get('joinedRepositories'))]
  let organizations: Model<Organization>[] = [...(<Model<Organization>[]>await auth.$get('ownedOrganizations')), ...(<Model<Organization>[]>await auth.$get('joinedOrganizations'))]

  let where: any = {
    [Op.or]: [
      { userId: ctx.session.id },
      { repositoryId: repositories.map(item => item.id) },
      { organizationId: organizations.map(item => item.id) },
    ],
  }
  let total = await Logger.count({ where })
  let pagination = new Pagination(total, ctx.query.cursor || 1, ctx.query.limit || 100)
  let logs = await Logger.findAll({
    where,
    attributes: {},
    include: [
      Object.assign({}, QueryInclude.Creator, { required: false }),
      QueryInclude.User,
      QueryInclude.Organization,
      QueryInclude.Repository,
      QueryInclude.Module,
      QueryInclude.Interface,
    ],
    offset: pagination.start,
    limit: pagination.limit,
    order: [
      ['id', 'DESC'],
    ],
    paranoid: false,
  } as any)

  ctx.body = {
    data: logs,
    pagination,
  }
})

router.get('/captcha', async (ctx) => {
  const captcha = svgCaptcha.create()
  ctx.session.captcha = captcha.text
  ctx.set('Content-Type', 'image/svg+xml')
  ctx.body = captcha.data
})

router.get('/worker', async (ctx) => {
  ctx.body = process.env.NODE_APP_INSTANCE || 'NOT FOUND'
})