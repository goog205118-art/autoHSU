(() => {
  const icons={campaign:'◈',drive_folder_upload:'↧',tune:'⚙',close:'×',add:'+',image:'▧',add_photo_alternate:'+',edit_note:'✎',auto_awesome:'✦',content_copy:'▣',arrow_back:'←',hub:'◇',psychology:'✧',photo_library:'▧',delete:'×',download:'↓',refresh:'↻',replay:'↻',check_circle:'✓',error:'!',link:'↗',public:'◎',thumb_up:'♡',chat_bubble_outline:'▢',share:'↗',more_horiz:'···',schedule:'◷',sync:'↻',open_in_new:'↗',image_search:'⌕',visibility:'◉',upload:'↑'};
  function decorate(root) {
    if(root.nodeType!==1)return;
    const nodes=[...(root.matches('.material-symbols-outlined')?[root]:[]),...root.querySelectorAll('.material-symbols-outlined')];
    for(const node of nodes){node.dataset.icon=icons[node.textContent.trim()]||'◇';node.setAttribute('aria-hidden','true');}
  }
  const observer=new MutationObserver((records)=>{for(const record of records)for(const node of record.addedNodes)decorate(node);});
  observer.observe(document.body,{childList:true,subtree:true});
  const gate=document.getElementById('access-gate');
  const showGate=()=>{gate.hidden=false;document.getElementById('access-code').focus();};
  window.addEventListener('social-auth-required',showGate);
  fetch('/api/session').then(response=>response.json()).then(session=>{
    if(session.requiresAuth&&!session.authenticated){
      showGate();
      if(!session.configured)document.getElementById('access-hint').textContent='请先在 Vercel 设置至少 12 位的 APP_ACCESS_CODE 环境变量，再重新部署。';
    }
  }).catch(()=>{});
  document.getElementById('access-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=event.currentTarget.querySelector('button');button.disabled=true;
    try {
      await window.SocialApi.login(document.getElementById('access-code').value);
      document.getElementById('access-code').value='';
      document.getElementById('access-error').textContent='';gate.hidden=true;
    } catch(error){document.getElementById('access-error').textContent=error.message;}
    finally {button.disabled=false;}
  });
  document.getElementById('open-workspace').addEventListener('click',()=>window.openSocialMediaTool());
  window.openSocialMediaTool();
  decorate(document.body);
})();
