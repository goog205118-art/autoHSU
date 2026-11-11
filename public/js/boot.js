(() => {
  const icons={campaign:'◈',drive_folder_upload:'↧',tune:'⚙',close:'×',add:'+',image:'▧',add_photo_alternate:'+',edit_note:'✎',auto_awesome:'✦',content_copy:'▣',arrow_back:'←',hub:'◇',psychology:'✧',photo_library:'▧',delete:'×',download:'↓',refresh:'↻',replay:'↻',check_circle:'✓',error:'!',link:'↗',public:'◎',thumb_up:'♡',chat_bubble_outline:'▢',share:'↗',more_horiz:'···',schedule:'◷',sync:'↻',open_in_new:'↗',image_search:'⌕',visibility:'◉',upload:'↑'};
  function decorate(root) {
    if(root.nodeType!==1)return;
    const nodes=[...(root.matches('.material-symbols-outlined')?[root]:[]),...root.querySelectorAll('.material-symbols-outlined')];
    for(const node of nodes){node.dataset.icon=icons[node.textContent.trim()]||'◇';node.setAttribute('aria-hidden','true');}
  }
  const observer=new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)decorate(node);});
  observer.observe(document.body,{childList:true,subtree:true});
  document.getElementById('open-workspace').addEventListener('click',()=>window.openSocialMediaTool());
  window.openSocialMediaTool();
  decorate(document.body);
})();
