(function(){
"use strict";
const names=["overview","ai","live","lineups"];
const tabs=names.map(name=>document.getElementById("tab-"+name));
function openTab(name){
  if(!names.includes(name))return;
  names.forEach(function(key){
    const active=key===name;
    document.getElementById("pane-"+key).hidden=!active;
    const tab=document.getElementById("tab-"+key);
    tab.setAttribute("aria-selected",String(active));
    tab.tabIndex=active?0:-1;
  });
}
tabs.forEach(function(tab,index){
  tab.addEventListener("click",function(){openTab(names[index]);});
  tab.addEventListener("keydown",function(e){
    if(e.key!=="ArrowRight"&&e.key!=="ArrowLeft"&&e.key!=="Home"&&e.key!=="End")return;
    e.preventDefault();
    const next=e.key==="Home"?0:e.key==="End"?names.length-1:(index+(e.key==="ArrowRight"?1:-1)+names.length)%names.length;
    openTab(names[next]);tabs[next].focus();
  });
});
const scenarios={
 base:{values:[54,27,19],title:"Базовый сценарий",text:"Сохраняется исходное распределение вероятностей. Числа приведены только для демонстрации взаимодействия."},
 goal:{values:[29,31,40],title:"Если гости забьют первыми",text:"Условная вероятность победы гостей увеличивается. В реальном продукте изменение зависит от минуты, xG, составов и хода матча."},
 absence:{values:[45,30,25],title:"Если лидер хозяев не сыграет",text:"Условная вероятность победы хозяев уменьшается. Реальный пересчёт возможен только при подтверждённых данных об игроке."}
};
document.querySelectorAll("[data-scenario]").forEach(function(button){
 button.addEventListener("click",function(){
  const name=button.dataset.scenario,scenario=scenarios[name];if(!scenario)return;
  document.querySelectorAll("[data-scenario]").forEach(function(item){item.setAttribute("aria-pressed",String(item===button));});
  ["Home","Draw","Away"].forEach(function(key,index){
   const value=scenario.values[index];
   document.getElementById("bar"+key).style.width=value+"%";
   document.getElementById("pct"+key).textContent=value+"%";
  });
  document.getElementById("scenarioTitle").textContent=scenario.title;
  document.getElementById("scenarioText").textContent=scenario.text;
 });
});
document.getElementById("goAi").addEventListener("click",function(){
 openTab("ai");document.getElementById("tab-ai").focus();window.scrollTo({top:0,behavior:"smooth"});
});
})();
