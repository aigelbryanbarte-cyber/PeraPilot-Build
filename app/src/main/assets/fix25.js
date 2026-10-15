(function(){
  'use strict';

  function ppParseDate(s){
    var p=(s||'').split('-').map(Number);
    return new Date(p[0],(p[1]||1)-1,p[2]||1,12,0,0,0);
  }
  function ppFmtDate(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function ppMonth(d){return ppFmtDate(d).slice(0,7)}
  function ppAddDays(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x}
  function ppPaydays(){
    var a=Math.min(28,Math.max(1,Number(db.settings.payday1||5)));
    var b=Math.min(28,Math.max(1,Number(db.settings.payday2||20)));
    if(a===b)b=a===20?5:20;
    return [a,b].sort(function(x,y){return x-y});
  }
  function ppNextPayDate(from){
    var d=ppParseDate(from||iso()), ds=ppPaydays(), y=d.getFullYear(),m=d.getMonth(),day=d.getDate();
    for(var i=0;i<ds.length;i++) if(day<=ds[i]) return ppFmtDate(new Date(y,m,ds[i],12));
    return ppFmtDate(new Date(y,m+1,ds[0],12));
  }
  function ppFollowingPayDate(payDate){
    var d=ppParseDate(payDate), ds=ppPaydays(), day=d.getDate(), y=d.getFullYear(),m=d.getMonth();
    if(day===ds[0]) return ppFmtDate(new Date(y,m,ds[1],12));
    return ppFmtDate(new Date(y,m+1,ds[0],12));
  }
  function ppActiveOn(obj,dateStr){
    return (!obj.start||dateStr>=obj.start)&&(!obj.end||dateStr<=obj.end);
  }
  function ppDueDatesInWindow(obj,startStr,endStr){
    var dd=Number(obj.dueDay||0); if(!dd) return [];
    var start=ppParseDate(startStr), end=ppParseDate(endStr), out=[];
    var base=new Date(start.getFullYear(),start.getMonth()-1,1,12);
    for(var i=0;i<4;i++){
      var y=base.getFullYear(),m=base.getMonth()+i;
      var last=new Date(y,m+1,0,12).getDate();
      var due=new Date(y,m,Math.min(dd,last),12);
      var s=ppFmtDate(due);
      if(due>=start && due<end && ppActiveOn(obj,s)) out.push({date:s,period:s.slice(0,7)});
    }
    return out;
  }
  function ppIncomeOnDate(dateStr,workOnly){
    return sum(incomes().filter(function(t){
      if(t.date!==dateStr)return false;
      return workOnly?isWorkSource(t.source):!isWorkSource(t.source);
    }));
  }
  function ppOtherSourcePaidThisMonth(){
    var p=(db.settings.expectedPayDate||ppNextPayDate()).slice(0,7);
    return sum(db.transactions.filter(function(t){
      if((t.type!=='debt'&&t.type!=='bill') || !t.date || t.date.slice(0,7)!==p) return false;
      var fs=t.fundingSource||'';
      return fs && fs!=='cash' && fs!=='Salary' && fs!=='Teaching';
    }));
  }

  window.forecastParts=function(){
    var payDate=db.settings.expectedPayDate||ppNextPayDate();
    var nextDate=ppFollowingPayDate(payDate);
    var payMonth=payDate.slice(0,7);
    var autoPay=ppIncomeOnDate(payDate,true);
    var autoExtra=ppIncomeOnDate(payDate,false);
    var pay=Number(db.settings.expectedPay||0); if(pay<=0) pay=autoPay;
    var extra=Number(db.settings.expectedExtra||0); if(extra<=0) extra=autoExtra;
    var income=pay+extra;
    var billNeed=0, debtNeed=0, billDetails=[], debtDetails=[];

    activeBills().forEach(function(b){
      var amt=Number(b.monthly||0); if(amt<=0)return;
      var dueDates=ppDueDatesInWindow(b,payDate,nextDate);
      var need=0;
      if(dueDates.length){
        dueDates.forEach(function(x){need+=Math.max(0,amt-coveredAmount(b,x.period));});
      } else if(!Number(b.dueDay||0) && ppActiveOn(b,payDate)) {
        var paid=coveredAmount(b,payMonth);
        need=Math.min(Math.max(0,amt-paid),amt/2);
      }
      if(need>0.005){billNeed+=need;billDetails.push({name:b.name,amount:need,due:dueDates.map(function(x){return x.date;}).join(', ')||'split reserve'});}
    });

    db.debts.forEach(function(d){
      var amt=Number(d.min||0); if(amt<=0||Number(d.balance||0)<=0)return;
      var dueDates=ppDueDatesInWindow(d,payDate,nextDate);
      var need=0;
      if(dueDates.length){
        dueDates.forEach(function(x){need+=Math.max(0,amt-debtPaidForPeriod(d,x.period));});
      } else if(!Number(d.dueDay||0)) {
        var paid=debtPaidForPeriod(d,payMonth);
        need=Math.min(Math.max(0,amt-paid),amt/2);
      }
      need=Math.min(need,Number(d.balance||0));
      if(need>0.005){debtNeed+=need;debtDetails.push({name:d.name,amount:need,due:dueDates.map(function(x){return x.date;}).join(', ')||'split minimum'});}
    });

    var living=Number(db.settings.living||0)/2;
    var required=billNeed+debtNeed+living;
    var left=income-required;
    var buffer=Number(db.settings.buffer||0);
    var safeLeft=left-buffer;
    return {
      cycle:'payday',p:payMonth,payDate:payDate,nextPayDate:nextDate,
      billNeed:billNeed,debtNeed:debtNeed,living:living,buffer:buffer,
      income:income,pay:pay,extra:extra,required:required,left:left,safeLeft:safeLeft,
      billDetails:billDetails,debtDetails:debtDetails,otherSourcePaid:ppOtherSourcePaidThisMonth(),
      autoPay:autoPay,autoExtra:autoExtra
    };
  };

  window.openForecast=function(){
    var f=forecastParts(), ds=ppPaydays();
    modal('Next payday estimate',
      '<label>Expected pay date</label><input id="fcPayDate" type="date" value="'+esc(f.payDate)+'">'+
      '<div class="form2"><div><label>Expected salary / pay</label><input id="fcPay" type="number" inputmode="decimal" value="'+(db.settings.expectedPay||f.autoPay||'')+'" placeholder="e.g. 14897.53"></div>'+
      '<div><label>Expected extra income</label><input id="fcExtra" type="number" inputmode="decimal" value="'+(db.settings.expectedExtra||f.autoExtra||'')+'" placeholder="Teaching, allowance, etc."></div></div>'+
      '<div class="form2"><div><label>First payday each month</label><input id="fcDay1" type="number" min="1" max="28" value="'+ds[0]+'"></div>'+
      '<div><label>Second payday each month</label><input id="fcDay2" type="number" min="1" max="28" value="'+ds[1]+'"></div></div>'+
      '<div class="notice" style="margin-top:10px">PeraPilot now uses your actual payday window. A pay on the 20th covers obligations due until the next 5th. A pay on the 5th covers obligations due until the next 20th. Payments already recorded from Papa/family or another source are not charged again to this salary. Items with no due day are split 50/50 until you set a due day.</div>'+
      '<button class="btn primary" style="width:100%;margin-top:11px" onclick="saveForecast()">Save & calculate</button>'
    );
  };

  window.saveForecast=function(){
    db.settings.expectedPayDate=val('fcPayDate')||ppNextPayDate();
    db.settings.expectedPay=num('fcPay');
    db.settings.expectedExtra=num('fcExtra');
    db.settings.payday1=Math.min(28,Math.max(1,num('fcDay1')||5));
    db.settings.payday2=Math.min(28,Math.max(1,num('fcDay2')||20));
    db.settings.forecastCycle='payday';
    closeModal();save();
  };

  window.renderForecast=function(){
    var f=forecastParts(), cls=f.left>=0?'g':'r';
    ['forecastIncome','incForecastIncome'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent=peso(f.income)});
    var req=document.getElementById('forecastRequired');if(req)req.textContent=peso(f.required);
    ['forecastLeft','incForecastLeft'].forEach(function(id){var e=document.getElementById(id);if(e){e.textContent=peso(f.left);e.className='statVal '+cls;}});
    var note=document.getElementById('forecastNote');
    if(note){
      if(f.income<=0) note.textContent='No expected pay found yet. Set the next pay amount/date or log a Salary transaction on that date.';
      else note.innerHTML='For <b>'+esc(f.payDate)+'</b>, after required bills/debts and half-month living allowance, estimated left is <b>'+peso(f.left)+'</b>. Suggested safe-to-spend after keeping your '+peso(f.buffer)+' buffer: <b>'+peso(f.safeLeft)+'</b>.';
    }
    var br=document.getElementById('forecastBreakdown');
    if(br){
      var html='';
      if(f.otherSourcePaid>0) html+='<div class="item"><div class="itemTop"><span>Already paid from non-salary source this month</span><span class="g">'+peso(f.otherSourcePaid)+'</span></div><small>Not deducted again from this payday.</small></div>';
      html+='<div class="item"><div class="itemTop"><span>Loans/cards due this pay cycle</span><span>'+peso(f.debtNeed)+'</span></div><small>'+esc(f.payDate)+' to before '+esc(f.nextPayDate)+'</small></div>';
      html+='<div class="item"><div class="itemTop"><span>Bills/installments due this pay cycle</span><span>'+peso(f.billNeed)+'</span></div></div>';
      html+='<div class="item"><div class="itemTop"><span>Half-month food/personal</span><span>'+peso(f.living)+'</span></div></div>';
      html+='<div class="item"><div class="itemTop"><span>Estimated left after essentials</span><span class="'+(f.left>=0?'g':'r')+'">'+peso(f.left)+'</span></div></div>';
      html+='<div class="item"><div class="itemTop"><span>Suggested cash buffer to keep</span><span>'+peso(f.buffer)+'</span></div><small>This is a reserve, not a bill.</small></div>';
      html+='<div class="item"><div class="itemTop"><span>Safe-to-spend estimate</span><span class="'+(f.safeLeft>=0?'g':'r')+'">'+peso(f.safeLeft)+'</span></div></div>';
      br.innerHTML=html;
    }
  };

  window.monthlyNeed=function(){var f=forecastParts();return f.required+f.buffer;};

  window.openDebt=function(id){
    var d=id?db.debts.find(function(x){return x.id===id;}):null;
    modal(d?'Edit debt':'Add debt',
      '<label>Name</label><input id="dName" value="'+esc(d&&d.name||'')+'">'+
      '<div class="form2"><div><label>Type</label><select id="dType"><option value="card" '+(d&&d.type==='card'?'selected':'')+'>Credit card</option><option value="loan" '+(d&&d.type==='loan'?'selected':'')+'>Loan</option></select></div>'+ 
      '<div><label>Due day (optional)</label><input id="dDue" type="number" min="1" max="31" value="'+(d&&d.dueDay||'')+'" placeholder="e.g. 26"></div>'+ 
      '<div><label>Current balance</label><input id="dBal" type="number" value="'+(d&&d.balance||'')+'"></div>'+ 
      '<div><label>Original / tracked starting balance</label><input id="dStart" type="number" value="'+(d&&(d.start||d.balance)||'')+'"></div>'+ 
      '<div><label>Monthly minimum</label><input id="dMin" type="number" value="'+(d&&d.min||'')+'"></div>'+ 
      '<div><label>Monthly target</label><input id="dTarget" type="number" value="'+(d&&d.target||'')+'"></div>'+ 
      '<div><label>Priority (1 highest)</label><input id="dPri" type="number" value="'+(d&&d.priority||1)+'"></div></div>'+ 
      '<button class="btn primary" style="width:100%;margin-top:11px" onclick="saveDebt(\''+(id||'')+'\')">Save debt</button>'
    );
  };

  window.saveDebt=function(id){
    var d=id?db.debts.find(function(x){return x.id===id;}):null;
    var o={id:id||uid(),name:val('dName'),type:val('dType'),dueDay:num('dDue')||0,balance:num('dBal'),start:num('dStart')||num('dBal'),min:num('dMin'),target:num('dTarget'),priority:num('dPri')||1};
    if(!o.name)return alert('Enter name.');if(d)Object.assign(d,o);else db.debts.push(o);closeModal();save();
  };

  try{
    document.title='PeraPilot 2.5';
    var badge=document.querySelector('.brand .pill');if(badge)badge.textContent='2.5 Smart';
    db.settings.payday1=db.settings.payday1||5;db.settings.payday2=db.settings.payday2||20;
    db.settings.expectedPayDate=db.settings.expectedPayDate||ppNextPayDate();
    save();
  }catch(e){console.error('PeraPilot 2.5 forecast patch error',e);}
})();
(function(){
  'use strict';

  function p26ParseDate(s){
    var p=(s||'').split('-').map(Number);
    return new Date(p[0],(p[1]||1)-1,p[2]||1,12,0,0,0);
  }
  function p26FmtDate(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function p26Paydays(){
    var a=Math.min(28,Math.max(1,Number(db.settings.payday1||5)));
    var b=Math.min(28,Math.max(1,Number(db.settings.payday2||20)));
    if(a===b)b=a===20?5:20;
    return [a,b].sort(function(x,y){return x-y});
  }
  function p26NextPayDate(from){
    var d=p26ParseDate(from||iso()), ds=p26Paydays(), y=d.getFullYear(),m=d.getMonth(),day=d.getDate();
    for(var i=0;i<ds.length;i++) if(day<=ds[i]) return p26FmtDate(new Date(y,m,ds[i],12));
    return p26FmtDate(new Date(y,m+1,ds[0],12));
  }
  function p26FollowingPayDate(payDate){
    var d=p26ParseDate(payDate), ds=p26Paydays(), day=d.getDate(), y=d.getFullYear(),m=d.getMonth();
    if(day===ds[0]) return p26FmtDate(new Date(y,m,ds[1],12));
    return p26FmtDate(new Date(y,m+1,ds[0],12));
  }
  function p26PreviousPayDate(payDate){
    var d=p26ParseDate(payDate), ds=p26Paydays(), day=d.getDate(), y=d.getFullYear(),m=d.getMonth();
    if(day===ds[1]) return p26FmtDate(new Date(y,m,ds[0],12));
    return p26FmtDate(new Date(y,m-1,ds[1],12));
  }
  function p26ActiveOn(obj,dateStr){return (!obj.start||dateStr>=obj.start)&&(!obj.end||dateStr<=obj.end)}
  function p26DueDatesInWindow(obj,startStr,endStr){
    var dd=Number(obj.dueDay||0); if(!dd) return [];
    var start=p26ParseDate(startStr), end=p26ParseDate(endStr), out=[];
    var base=new Date(start.getFullYear(),start.getMonth()-1,1,12);
    for(var i=0;i<4;i++){
      var y=base.getFullYear(),m=base.getMonth()+i;
      var last=new Date(y,m+1,0,12).getDate();
      var due=new Date(y,m,Math.min(dd,last),12);
      var s=p26FmtDate(due);
      if(due>=start && due<end && p26ActiveOn(obj,s)) out.push({date:s,period:s.slice(0,7)});
    }
    return out;
  }
  function p26IncomeOnDate(dateStr,workOnly){
    return sum(incomes().filter(function(t){
      if(t.date!==dateStr)return false;
      return workOnly?isWorkSource(t.source):!isWorkSource(t.source);
    }));
  }
  function p26DebtPaidInCutoff(d,payDate){
    var prev=p26PreviousPayDate(payDate);
    return sum(db.transactions.filter(function(t){
      return t.type==='debt' && t.targetId===d.id && t.date && t.date>=prev && t.date<=payDate;
    }));
  }
  function p26SuggestedCutoff(d){
    var explicit=Number(d.cutoffTarget||0);
    if(explicit>0)return explicit;
    var monthlyTarget=Number(d.target||0);
    var monthlyMin=Number(d.min||0);
    if(monthlyTarget>0)return Math.max(monthlyMin/2,monthlyTarget/2);
    return monthlyMin/2;
  }
  function p26OtherSourcePaidThisMonth(){
    var p=(db.settings.expectedPayDate||p26NextPayDate()).slice(0,7);
    return sum(db.transactions.filter(function(t){
      if((t.type!=='debt'&&t.type!=='bill') || !t.date || t.date.slice(0,7)!==p) return false;
      var fs=t.fundingSource||'';
      return fs && fs!=='cash' && fs!=='Salary' && fs!=='Teaching';
    }));
  }

  window.forecastParts=function(){
    var payDate=db.settings.expectedPayDate||p26NextPayDate();
    var nextDate=p26FollowingPayDate(payDate);
    var payMonth=payDate.slice(0,7);
    var autoPay=p26IncomeOnDate(payDate,true);
    var autoExtra=p26IncomeOnDate(payDate,false);
    var pay=Number(db.settings.expectedPay||0); if(pay<=0) pay=autoPay;
    var extra=Number(db.settings.expectedExtra||0); if(extra<=0) extra=autoExtra;
    var income=pay+extra;
    var billNeed=0, debtNeed=0, billDetails=[], debtDetails=[];

    activeBills().forEach(function(b){
      var amt=Number(b.monthly||0); if(amt<=0)return;
      var dueDates=p26DueDatesInWindow(b,payDate,nextDate);
      var need=0;
      if(dueDates.length){
        dueDates.forEach(function(x){need+=Math.max(0,amt-coveredAmount(b,x.period));});
      } else if(!Number(b.dueDay||0) && p26ActiveOn(b,payDate)) {
        var paid=coveredAmount(b,payMonth);
        need=Math.min(Math.max(0,amt-paid),amt/2);
      }
      if(need>0.005){
        billNeed+=need;
        billDetails.push({name:b.name,amount:need,due:dueDates.map(function(x){return x.date;}).join(', ')||'split reserve'});
      }
    });

    db.debts.forEach(function(d){
      var bal=Number(d.balance||0); if(bal<=0)return;
      var suggested=Math.min(bal,p26SuggestedCutoff(d));
      var paidCutoff=p26DebtPaidInCutoff(d,payDate);
      var plannedNeed=Math.max(0,suggested-paidCutoff);
      var dueDates=p26DueDatesInWindow(d,payDate,nextDate);
      var dueNeed=0;
      if(dueDates.length){
        dueDates.forEach(function(x){
          dueNeed+=Math.max(0,Number(d.min||0)-debtPaidForPeriod(d,x.period));
        });
      }
      var need=Math.min(bal,Math.max(plannedNeed,dueNeed));
      if(need>0.005){
        debtNeed+=need;
        debtDetails.push({
          name:d.name,
          amount:need,
          suggested:suggested,
          paidCutoff:paidCutoff,
          due:dueDates.map(function(x){return x.date;}).join(', ')||'planned per cutoff'
        });
      }
    });

    var living=Number(db.settings.living||0)/2;
    var required=billNeed+debtNeed+living;
    var left=income-required;
    var buffer=Number(db.settings.buffer||0);
    var safeLeft=left-buffer;
    return {
      cycle:'payday',p:payMonth,payDate:payDate,nextPayDate:nextDate,
      billNeed:billNeed,debtNeed:debtNeed,living:living,buffer:buffer,
      income:income,pay:pay,extra:extra,required:required,left:left,safeLeft:safeLeft,
      billDetails:billDetails,debtDetails:debtDetails,otherSourcePaid:p26OtherSourcePaidThisMonth(),
      autoPay:autoPay,autoExtra:autoExtra
    };
  };

  window.renderForecast=function(){
    var f=forecastParts(), cls=f.left>=0?'g':'r';
    ['forecastIncome','incForecastIncome'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent=peso(f.income)});
    var req=document.getElementById('forecastRequired');if(req)req.textContent=peso(f.required);
    ['forecastLeft','incForecastLeft'].forEach(function(id){var e=document.getElementById(id);if(e){e.textContent=peso(f.left);e.className='statVal '+cls;}});
    var note=document.getElementById('forecastNote');
    if(note){
      if(f.income<=0) note.textContent='No expected pay found yet. Set the next pay amount/date or log a Salary transaction on that date.';
      else note.innerHTML='For <b>'+esc(f.payDate)+'</b>, after your planned cutoff payments, bills and living reserve, estimated left is <b>'+peso(f.left)+'</b>. After keeping your '+peso(f.buffer)+' buffer, safe-to-spend is <b>'+peso(f.safeLeft)+'</b>.';
    }
    var br=document.getElementById('forecastBreakdown');
    if(br){
      var html='';
      if(f.otherSourcePaid>0) html+='<div class="item"><div class="itemTop"><span>Already paid from non-salary source this month</span><span class="g">'+peso(f.otherSourcePaid)+'</span></div><small>Not deducted again from this payday.</small></div>';
      html+='<div class="item"><div class="itemTop"><span><b>Suggested debt payments this cutoff</b></span><span><b>'+peso(f.debtNeed)+'</b></span></div><small>You can edit each debt\'s suggested per-cutoff amount in Loans & bills.</small></div>';
      f.debtDetails.forEach(function(x){
        var paid=x.paidCutoff>0?' · '+peso(x.paidCutoff)+' already paid in this cutoff':'';
        html+='<div class="item"><div class="itemTop"><span>'+esc(x.name)+'</span><span class="y">'+peso(x.amount)+'</span></div><small>Suggested this cutoff: '+peso(x.suggested)+paid+' · '+esc(x.due)+'</small></div>';
      });
      html+='<div class="item"><div class="itemTop"><span><b>Bills/installments this cutoff</b></span><span><b>'+peso(f.billNeed)+'</b></span></div></div>';
      f.billDetails.forEach(function(x){
        html+='<div class="item"><div class="itemTop"><span>'+esc(x.name)+'</span><span>'+peso(x.amount)+'</span></div><small>'+esc(x.due)+'</small></div>';
      });
      html+='<div class="item"><div class="itemTop"><span>Half-month food/personal</span><span>'+peso(f.living)+'</span></div></div>';
      html+='<div class="item"><div class="itemTop"><span><b>Total planned before free spending</b></span><span class="y"><b>'+peso(f.required)+'</b></span></div></div>';
      html+='<div class="item"><div class="itemTop"><span>Estimated left after planned payments</span><span class="'+(f.left>=0?'g':'r')+'">'+peso(f.left)+'</span></div></div>';
      html+='<div class="item"><div class="itemTop"><span>Suggested cash buffer to keep</span><span>'+peso(f.buffer)+'</span></div><small>This is a reserve, not a bill.</small></div>';
      html+='<div class="item"><div class="itemTop"><span><b>Safe-to-spend after buffer</b></span><span class="'+(f.safeLeft>=0?'g':'r')+'"><b>'+peso(f.safeLeft)+'</b></span></div></div>';
      br.innerHTML=html;
    }
  };

  window.openDebt=function(id){
    var d=id?db.debts.find(function(x){return x.id===id;}):null;
    var cutoff=d?(Number(d.cutoffTarget||0)||Math.max(Number(d.min||0)/2,Number(d.target||0)/2)):0;
    modal(d?'Edit debt':'Add debt',
      '<label>Name</label><input id="dName" value="'+esc(d&&d.name||'')+'">'+
      '<div class="form2"><div><label>Type</label><select id="dType"><option value="card" '+(d&&d.type==='card'?'selected':'')+'>Credit card</option><option value="loan" '+(d&&d.type==='loan'?'selected':'')+'>Loan</option></select></div>'+ 
      '<div><label>Due day (optional)</label><input id="dDue" type="number" min="1" max="31" value="'+(d&&d.dueDay||'')+'" placeholder="e.g. 26"></div>'+ 
      '<div><label>Current balance</label><input id="dBal" type="number" value="'+(d&&d.balance||'')+'"></div>'+ 
      '<div><label>Original / tracked starting balance</label><input id="dStart" type="number" value="'+(d&&(d.start||d.balance)||'')+'"></div>'+ 
      '<div><label>Monthly minimum</label><input id="dMin" type="number" value="'+(d&&d.min||'')+'"></div>'+ 
      '<div><label>Monthly target</label><input id="dTarget" type="number" value="'+(d&&d.target||'')+'"></div>'+ 
      '<div><label>Suggested payment per cutoff</label><input id="dCutoff" type="number" value="'+(cutoff||'')+'" placeholder="e.g. 2500"></div>'+ 
      '<div><label>Priority (1 highest)</label><input id="dPri" type="number" value="'+(d&&d.priority||1)+'"></div></div>'+ 
      '<div class="notice" style="margin-top:10px">This amount is what PeraPilot will suggest setting aside from each 5th/20th payday. If blank, it uses half of your monthly target (but never below half of the monthly minimum).</div>'+ 
      '<button class="btn primary" style="width:100%;margin-top:11px" onclick="saveDebt(\''+(id||'')+'\')">Save debt</button>'
    );
  };

  window.saveDebt=function(id){
    var d=id?db.debts.find(function(x){return x.id===id;}):null;
    var o={id:id||uid(),name:val('dName'),type:val('dType'),dueDay:num('dDue')||0,balance:num('dBal'),start:num('dStart')||num('dBal'),min:num('dMin'),target:num('dTarget'),cutoffTarget:num('dCutoff')||0,priority:num('dPri')||1};
    if(!o.name)return alert('Enter name.');
    if(d)Object.assign(d,o);else db.debts.push(o);
    closeModal();save();
  };

  try{
    document.title='PeraPilot 2.6';
    var badge=document.querySelector('.brand .pill');if(badge)badge.textContent='2.6 Smart';
    db.debts.forEach(function(d){
      if(!Number(d.cutoffTarget||0) && Number(d.target||0)>0){
        d.cutoffTarget=Math.max(Number(d.min||0)/2,Number(d.target||0)/2);
      }
    });
    save();
  }catch(e){console.error('PeraPilot 2.6 cutoff plan patch error',e);}
})();