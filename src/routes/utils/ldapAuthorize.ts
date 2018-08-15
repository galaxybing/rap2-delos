// import ldap from 'ldapjs'
const ldap = require('ldapjs');
import config from '../../config'

let ldapAuthorizeTimerID: any;

export const ldapAuthorize = {
  login: function(username: string, userPassword: string) {
    const ldapConfig = config.ldap;
    let client = ldap.createClient({
      url: ldapConfig.serverUrl
    });
    let options = {
      // filter: '(sAMAccountName=' + username + ')', //查询条件过滤器, 查找username该用户节点
      //
      filter: `(&(objectClass=inetOrgPerson)(cn=${username}))`,
      // filter: ldap.parseFilter('(objectclass=*)'),
      scope: 'sub', // 查询范围
      // the maximum amount of time the server should take in responding, in seconds. Defaults to 10. Lots of servers will ignore this.
      timeLimit: 10,
    };

    return new Promise(function(resolve, reject) {
      client.bind(ldapConfig.bindDn, ldapConfig.bindPassword, function(err: any, /* matched: any, */) {
        if (err) {
          // 在 外层调用时已经被 try catch
        }
        client.search(ldapConfig.basicDn, options, function(err: any, result: any) {
          if (err) {
            //
          }
          result.on('searchEntry', function(entry: any) {
            // 获取查询的对象
            let user = entry.object;
            // 获取 用户 DN
            // mail=*@317hu.com,ou=Users,domainName=317hu.com,o=domains,dc=317hu,dc=com
            const userDN = user.dn;
            // 校验 用户的密码
            try {
              client.bind(userDN, userPassword, function(err: any /* , res: any */) { // res: any
                if (ldapAuthorizeTimerID) {
                  clearTimeout(ldapAuthorizeTimerID);
                }
                if (err) {
                  reject({ errCode: 1, errMsg: `密码错误`});
                } else {
                  // {"messageID":3,"protocolOp":"LDAPResult","status":0,"matchedDN":"","errorMessage":"","referrals":[],"controls":[]}
                  resolve({ data: user, success: true });
                }
              });
            } catch (err) {
              //
            }

          });
          result.on('searchReference', function(referral: any) {
            console.log('referral: ' + referral.uris.join());
          });
          // 查询错误事件
          result.on('error', function(err: any) {
            console.error('error: ' + err.message);
            client.unbind(); // unbind操作，必须要做
          });
          // 查询结束
          result.on('end', function(res: any) {
            // if (typeof res.status === 'undefined') {
            //   resolve({ errCode: res.status, errMsg: `查询结束`});
            // }
            ldapAuthorizeTimerID = setTimeout(function () {
              resolve({ errCode: res.status, errMsg: `用户名错误`});
            }, 10000);
            client.unbind(); // unbind操作，必须要做
          });
        });
      });
    });
  }
}
