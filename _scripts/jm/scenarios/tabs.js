(function () {
  return new Promise(function (resolve) {
    var out = {};
    var M = window.mangaLib || {};
    out.有接口 = ['tabsList', 'tabsCurrent', 'tabsClose'].map(function (k) { return k + ':' + (typeof M[k]); }).join(' ');
    Promise.resolve(M.tabsList ? M.tabsList() : null).then(function (r) {
      out.tabsList = r ? { ok: r.ok, 标签数: (r.tabs || []).length, 作品页: r.作品页, msg: r.msg || '' } : '没有接口';
      var s = (r && r.tabs || []).filter(function (t) { return t.work; }).slice(0, 3).map(function (t) { return t.title.slice(0, 22) + ' | ' + t.url.slice(0, 46); });
      out.作品页样本 = s;
      return Promise.resolve(M.tabsCurrent ? M.tabsCurrent() : null);
    }).then(function (c) {
      out.tabsCurrent = c ? { ok: c.ok, 当前标签: c.tab ? c.tab.title.slice(0, 30) : '(无)', 是作品页: c.tab ? c.tab.work : null, active: c.tab ? c.tab.active : null } : '没有接口';
      resolve(JSON.stringify(out, null, 1));
    }).catch(function (e) { out.错误 = String(e); resolve(JSON.stringify(out, null, 1)); });
  });
})()