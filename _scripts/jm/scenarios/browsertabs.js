(function () {
  return new Promise(function (resolve) {
    var out = { 步骤: [] };
    var M = window.mangaLib || {};
    out.步骤.push('有 dlResolve: ' + (typeof M.dlResolve));
    Promise.resolve(M.dlResolve('browsertabs:list')).then(function (r) {
      out.ok = r && r.ok;
      out.msg = (r && r.msg) || '';
      out.标题 = (r && r.title) || '';
      out.作品数 = (r && r.galleries ? r.galleries.length : 0);
      out.前3个 = (r && r.galleries || []).slice(0, 3).map(function (x) {
        return { id: x.id, title: String(x.title).slice(0, 22), 有封面: !!x.thumb, extra: x.extra };
      });
      resolve(JSON.stringify(out, null, 1));
    }).catch(function (e) {
      out.异常 = String(e && e.message || e).slice(0, 200);
      resolve(JSON.stringify(out, null, 1));
    });
  });
})()