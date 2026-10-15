(function(){
  function debtLikeBill(b){
    const c=(b.category||'').toLowerCase();
    const n=(b.name||'').toLowerCase();
    return c==='loan'||c==='installment'||/loan|billease|installment|amort/.test(n);
  }

  function rangeMonths(start,end){
    if(!start||!end)return[];
    const s=start.slice(0,7), e=end.slice(0,7);
    let [y,m]=s.split('-').map(Number), [ey,em]=e.split('-').map(Number), out=[];
    while(y<ey||(y===ey&&m<=em)){
      out.push(`${y}-${String(m).padStart(2,'0')}`);
      m++; if(m>12){m=1;y++;}
      if(out.length>240)break;
    }
    return out;
  }

  window.coveredAmount=function(b,period){
    return db.transactions
      .filter(t=>t.type==='bill'&&t.targetId===b.id&&((t.periods||[]).includes(period)||t.period===period))
      .reduce((s,t)=>{
        if(t.coverage&&t.coverage[period]!=null)return s+(+t.coverage[period]||0);
        if((t.periods||[]).includes(period)&&t.effect==='advance'&&+b.monthly>0){
          const i=t.periods.indexOf(period), total=+(t.coveredAmount||t.amount||0);
          const share=Math.max(0,Math.min(+b.monthly,total-i*(+b.monthly)));
          return s+share;
        }
        return s+(+t.coveredAmount||+t.amount||0);
      },0);
  };

  window.scheduledRemaining=function(b){
    if(!debtLikeBill(b)||!b.end||!b.monthly)return 0;
    const start=(b.start||iso()).slice(0,7);
    return rangeMonths(start,b.end).reduce((s,p)=>s+Math.max(0,(+b.monthly||0)-window.coveredAmount(b,p)),0);
  };

  window.totalDebt=function(){
    const direct=db.debts.reduce((s,d)=>s+Math.max(0,+d.balance||0),0);
    const installments=db.bills.reduce((s,b)=>s+window.scheduledRemaining(b),0);
    return direct+installments;
  };

  function makeCoverage(b,start,amount,advance){
    const coverage={}, periods=[];
    let left=amount;
    if(!advance||!+b.monthly){coverage[start]=amount;periods.push(start);return{coverage,periods};}
    let [y,m]=start.split('-').map(Number),i=0;
    while(left>0.0001&&i<120){
      const d=new Date(y,m-1+i,1), p=d.toISOString().slice(0,7), a=Math.min(left,+b.monthly);
      coverage[p]=a;periods.push(p);left-=a;i++;
    }
    return{coverage,periods};
  }

  window.saveSmartPay=function(){
    const target=val('spTarget'), pay=num('spPayAmt'), date=val('spPayDate')||iso(), fund=val('spFund'), effect=val('spEffect'), period=val('spPeriod')||ym(date);
    if(!target||pay<=0)return alert('Choose what to pay and enter the payment amount.');
    const [kind,id]=target.split(':');
    const obj=kind==='debt'?db.debts.find(x=>x.id===id):db.bills.find(x=>x.id===id);
    if(!obj)return alert('Target not found.');
    const group=uid();
    if(fund!=='cash'){
      let recv=num('spReceived'); if(recv<=0)recv=pay;
      db.cash+=recv;
      db.transactions.push({id:uid(),groupId:group,date,type:'income',source:fund,note:val('spIncomeNote')||'Money received for payment',amount:recv});
    }
    if(db.cash<pay&&!confirm(`Recorded cash is only ${peso(db.cash)}. Save payment anyway?`))return;
    db.cash-=pay;
    if(kind==='debt'){
      if(effect!=='record')obj.balance=Math.max(0,(+obj.balance||0)-pay);
      db.transactions.push({id:uid(),groupId:group,date,type:'debt',targetId:id,note:val('spNote')||obj.name,amount:pay,fundingSource:fund,effect,periods:[period]});
    }else{
      const alloc=makeCoverage(obj,period,pay,effect==='advance');
      db.transactions.push({id:uid(),groupId:group,date,type:'bill',targetId:id,note:val('spNote')||obj.name,amount:pay,coveredAmount:pay,coverage:alloc.coverage,fundingSource:fund,effect,periods:alloc.periods});
    }
    closeModal();save();
    alert('Saved. Your total debt / installment balance has been recalculated.');
  };

  window.renderBills=function(){
    const el=document.getElementById('billList');
    if(!el)return;
    el.innerHTML=db.bills.length?db.bills.map(b=>{
      const rem=window.scheduledRemaining(b);
      const debtInfo=debtLikeBill(b)&&b.end?` · remaining schedule ${peso(rem)}`:'';
      return `<div class="item"><div class="itemTop"><span>${esc(b.name)}</span><span>${peso(b.monthly)}/mo</span></div><small>${b.dueDay?'Due day '+b.dueDay:'Recurring'}${b.end?' · ends '+b.end:''}${debtInfo}</small><div class="actions"><button class="btn primary small" onclick="openSmartPay('bill','${b.id}')">Pay / Advance</button><button class="btn ghost small" onclick="openBill('${b.id}')">Edit</button></div></div>`;
    }).join(''):'<div class="empty">No recurring bills.</div>';
  };

  window.openBill=function(id=''){
    const b=id?db.bills.find(x=>x.id===id):null;
    const cat=b?.category||(debtLikeBill(b||{})?'loan':'bill');
    modal(b?'Edit bill':'Add recurring obligation',`<label>Name</label><input id="bName" value="${esc(b?.name||'')}"><div class="form2"><div><label>Category</label><select id="bCategory"><option value="bill" ${cat==='bill'?'selected':''}>Utility / recurring bill</option><option value="loan" ${cat==='loan'?'selected':''}>Loan installment</option><option value="installment" ${cat==='installment'?'selected':''}>Installment purchase</option><option value="transport" ${cat==='transport'?'selected':''}>Transport / variable</option></select></div><div><label>Monthly amount</label><input id="bAmt" type="number" value="${b?.monthly||''}"></div><div><label>Due day</label><input id="bDue" type="number" min="1" max="31" value="${b?.dueDay||''}"></div><div><label>Start date</label><input id="bStart" type="date" value="${b?.start||''}"></div><div><label>End date</label><input id="bEnd" type="date" value="${b?.end||''}"></div></div><div class="notice" style="margin-top:10px">Loan/installment categories with an end date count toward Total debt + installment balance. Utilities do not.</div><button class="btn primary" style="width:100%;margin-top:11px" onclick="saveBill('${id}')">Save</button>`);
  };

  window.saveBill=function(id){
    const b=id?db.bills.find(x=>x.id===id):null;
    const o={id:id||uid(),name:val('bName'),category:val('bCategory')||'bill',monthly:num('bAmt'),dueDay:num('bDue'),start:val('bStart'),end:val('bEnd')};
    if(!o.name||o.monthly<=0)return alert('Enter details.');
    if(b)Object.assign(b,o);else db.bills.push(o);
    closeModal();save();
  };

  const oldRender=window.render;
  window.render=function(){
    oldRender();
    const label=document.querySelector('#mDebt')?.previousElementSibling;
    if(label)label.textContent='Total debt + installment balance';
    const m=document.getElementById('mDebt');if(m)m.textContent=peso(window.totalDebt());
    window.renderBills();
  };

  document.title='PeraPilot 2.3';
  const badge=document.querySelector('.brand .pill');if(badge)badge.textContent='2.3 Smart';
  window.render();
})();
