// localStorage 读写
// 全部用 try 包住: 隐私模式 / 配额满时 localStorage 可能抛错, 不能让它打断界面

export function loadAlbums() { try { return JSON.parse(localStorage.getItem("albums") || "{}"); } catch (e) { return {}; } }

export function saveAlbums(a) { try { localStorage.setItem("albums", JSON.stringify(a)); } catch (e) {} }

// 书架浏览状态的存储键(核心另一处 saveShelfView 也要用, 所以导出)
export const VIEW_KEY = "shelfView";

// 背景图历史(最多 6 条)
export     function getBgHist(){ try { return JSON.parse(localStorage.getItem('bgHist') || '[]'); } catch(e){ return []; } }

export     function setBgHist(arr){ try { localStorage.setItem('bgHist', JSON.stringify(arr.slice(0,6))); } catch(e){} }

// 书签(最多 800 条)
export function bmAll() { try { var a = JSON.parse(localStorage.getItem('bookmarks') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

export function bmSave(a) { try { localStorage.setItem('bookmarks', JSON.stringify(a.slice(0, 800))); } catch (e) {} }

// 书架手动排序
export function manualOrder() { try { return JSON.parse(localStorage.getItem('shelfOrder') || '{}'); } catch (e) { return {}; } }

export function saveManualOrder(o) { try { localStorage.setItem('shelfOrder', JSON.stringify(o)); } catch (e) {} }

// 书架浏览状态(筛选/排序/搜索词/滚动位置)
export function loadShelfView() {
  try { return JSON.parse(localStorage.getItem(VIEW_KEY) || "null"); } catch (e) { return null; }
}
