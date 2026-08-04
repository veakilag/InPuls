from __future__ import annotations
import argparse,json,math,sys
from dataclasses import dataclass,asdict
from pathlib import Path
import numpy as np,pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier,HistGradientBoostingRegressor

EPS=1e-12
@dataclass(frozen=True)
class Exit:
    name:str; stop:float; partial:float; share:float; runner:float; be:float; hold:int
EXITS=[Exit('tight-4r',.8,1,.45,4,.8,24),Exit('tight-5r',.8,1.5,.4,5,1,36),Exit('base-4r',1.2,1.5,.5,4,1,24),Exit('base-5r',1.2,1.5,.4,5,1,48),Exit('wide-5r',1.6,1.5,.45,5,1,48)]
FEATURES=['d_m1','d_m3','d_m12','d_m48','d_flow','d_flow3','d_flow12','oi1','oi3','oi12','oi48','oi_z','d_ema','d_macro','d_btc12','d_btc48','d_rel12','d_rel48','crowd','top_crowd','position_crowd','funding_crowd','premium_crowd','volume_z','count_z','atr_rel','range_atr','compression','liq_proxy','direction_rank','oi_rank','flow_rank','liquidity_rank','close_strength']

def args():
 p=argparse.ArgumentParser();p.add_argument('--data-dir',required=True);p.add_argument('--symbols',default='BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,ADAUSDT,LINKUSDT,AVAXUSDT,LTCUSDT');p.add_argument('--start',default='2024-01-01');p.add_argument('--train-end',default='2026-01-01');p.add_argument('--validation-end',default='2026-06-01');p.add_argument('--holdout-end',default='2026-07-21');p.add_argument('--minimum-holdout-trades',type=int,default=30);p.add_argument('--output',default='algo-derivatives-research-result.json');return p.parse_args()
def utc(s):
 if pd.api.types.is_datetime64_any_dtype(s):return pd.to_datetime(s,utc=True)
 x=pd.to_numeric(s,errors='coerce');m=float(x[np.isfinite(x)].median());u='ns' if m>1e17 else 'us' if m>1e14 else 'ms' if m>1e11 else 's';return pd.to_datetime(x,unit=u,utc=True,errors='coerce')
def nums(d,cs):
 for c in cs:
  if c in d:d[c]=pd.to_numeric(d[c],errors='coerce')
def z(s,w,m=None):
 m=m or max(20,w//4);a=s.rolling(w,min_periods=m);return (s-a.mean())/a.std(ddof=0).replace(0,np.nan)
def optional(p):return pd.read_parquet(p) if p.exists() else None

def load(root,symbol,start,end):
 p=root/symbol/f'{symbol}_5m.parquet';m=root/symbol/f'{symbol}_metrics.parquet'
 if not p.exists() or not m.exists():raise FileNotFoundError('price or metrics missing')
 d=pd.read_parquet(p);d['time']=utc(d.open_time);nums(d,['open','high','low','close','volume','quote_volume','count','taker_buy_quote_volume']);d=d[(d.time>=start)&(d.time<end)].sort_values('time').drop_duplicates('time')
 q=pd.read_parquet(m);q['time']=utc(q.create_time);mc=['sum_open_interest_value','count_toptrader_long_short_ratio','sum_toptrader_long_short_ratio','count_long_short_ratio','sum_taker_long_short_vol_ratio'];nums(q,mc);q=q[['time',*mc]].sort_values('time').drop_duplicates('time');d=pd.merge_asof(d,q,on='time',direction='backward',tolerance=pd.Timedelta('10min'))
 f=optional(root/symbol/f'{symbol}_fundingRate.parquet')
 if f is not None and len(f):f['time']=utc(f.calc_time);nums(f,['last_funding_rate']);d=pd.merge_asof(d.sort_values('time'),f[['time','last_funding_rate']].sort_values('time').drop_duplicates('time'),on='time',direction='backward')
 else:d['last_funding_rate']=0
 pr=optional(root/symbol/f'{symbol}_premiumIndex_5m.parquet')
 if pr is not None and len(pr):pr['time']=utc(pr.open_time);nums(pr,['close']);d=pd.merge_asof(d.sort_values('time'),pr[['time','close']].rename(columns={'close':'premium'}).sort_values('time').drop_duplicates('time'),on='time',direction='backward',tolerance=pd.Timedelta('10min'))
 else:d['premium']=0
 d['symbol']=symbol;return d.dropna(subset=['open','high','low','close','quote_volume','sum_open_interest_value']).reset_index(drop=True)

def feat(d):
 d=d.copy();pc=d.close.shift();tr=pd.concat([d.high-d.low,(d.high-pc).abs(),(d.low-pc).abs()],axis=1).max(axis=1);d['atr']=tr.ewm(alpha=1/14,adjust=False,min_periods=14).mean();d['atr_rel']=d.atr/d.close;d['range_atr']=(d.high-d.low)/d.atr;d['cl']=(d.close-d.low)/(d.high-d.low).replace(0,np.nan)
 for n in [1,3,12,48]:d[f'r{n}']=d.close.pct_change(n);d[f'm{n}']=d[f'r{n}']/d.atr_rel
 d['e9']=d.close.ewm(span=9,adjust=False).mean();d['e30']=d.close.ewm(span=30,adjust=False).mean();d['e90']=d.close.ewm(span=90,adjust=False).mean();d['ema']=(d.e9-d.e30)/d.close;d['macro']=(d.e30-d.e90)/d.close
 for n in [20,60]:d[f'ph{n}']=d.high.shift().rolling(n,min_periods=n).max();d[f'pl{n}']=d.low.shift().rolling(n,min_periods=n).min()
 d['flow']=(2*d.taker_buy_quote_volume/d.quote_volume.replace(0,np.nan)-1).clip(-1,1);d['flow3']=d.flow.ewm(span=3,adjust=False).mean();d['flow12']=d.flow.ewm(span=12,adjust=False).mean();d['volume_z']=z(np.log1p(d.quote_volume),288);d['count_z']=z(np.log1p(d['count']),288);d['q24']=d.quote_volume.rolling(288,min_periods=144).sum()
 oi=d.sum_open_interest_value.replace(0,np.nan);d['oi_z']=z(np.log(oi),288)
 for n in [1,3,12,48]:d[f'oi{n}']=oi.pct_change(n)
 for src,n in [('count_toptrader_long_short_ratio','top'),('sum_toptrader_long_short_ratio','pos'),('count_long_short_ratio','crowd')]:d[f'{n}_z']=z(np.log(d[src].clip(lower=EPS)),288)
 d['funding_z']=z(d.last_funding_rate.fillna(0),2016,288);d['premium_z']=z(d.premium.fillna(0),288);d['compression']=d.atr_rel/d.atr_rel.rolling(288,min_periods=144).median();d['prev_compression']=d.compression.shift();d['liq_proxy']=(-d.oi3).clip(lower=0)*d.m3.abs()*(1+d.volume_z.clip(lower=0));d['bar']=np.arange(len(d));return d

def panelize(fs):
 d=pd.concat(fs.values(),ignore_index=True)
 for c in ['r12','r48','oi12','flow3','volume_z','atr_rel','q24']:d[f'{c}_rank']=d.groupby('time')[c].rank(pct=True)
 b=d[d.symbol=='BTCUSDT'][['time','r12','r48','ema','macro']].rename(columns={c:f'btc_{c}' for c in ['r12','r48','ema','macro']});d=d.merge(b,on='time',how='left');d['rel12']=d.r12-d.btc_r12;d['rel48']=d.r48-d.btc_r48;d['active']=(d.q24>1e7)&(d.q24_rank>=.2);return d

def events(p):
 out=[]
 def emit(mask,fam,side):
  x=p[mask&p.active].copy()
  if len(x):x['family']=fam;x['side']=side;x['entry']=x.bar+1;out.append(x)
 lb=(p.close>p.ph20)|(p.close>p.ph60);sb=(p.close<p.pl20)|(p.close<p.pl60)
 emit(lb&(p.oi12>.001)&(p.flow3>.03)&(p.volume_z>-.25)&(p.funding_z<2.5),'oi-momentum',1);emit(sb&(p.oi12>.001)&(p.flow3<-.03)&(p.volume_z>-.25)&(p.funding_z>-2.5),'oi-momentum',-1)
 emit((p.m3<-1.2)&(p.oi3<-.003)&(p.flow<-.08)&(p.volume_z>.3)&(p.cl>.52),'liquidation-reversal',1);emit((p.m3>1.2)&(p.oi3<-.003)&(p.flow>.08)&(p.volume_z>.3)&(p.cl<.48),'liquidation-reversal',-1)
 emit((p.m3>1.2)&(p.oi3<-.003)&(p.flow3>.08)&(p.volume_z>.3)&(p.cl>.65),'liquidation-continuation',1);emit((p.m3<-1.2)&(p.oi3<-.003)&(p.flow3<-.08)&(p.volume_z>.3)&(p.cl<.35),'liquidation-continuation',-1)
 emit((p.crowd_z<-1.2)&(p.flow3>.05)&(lb|(p.m3>.8)),'crowd-squeeze',1);emit((p.crowd_z>1.2)&(p.flow3<-.05)&(sb|(p.m3<-.8)),'crowd-squeeze',-1)
 emit((p.prev_compression<.85)&(p.oi12>.001)&lb&(p.volume_z>.5)&(p.flow3>.05),'compression-release',1);emit((p.prev_compression<.85)&(p.oi12>.001)&sb&(p.volume_z>.5)&(p.flow3<-.05),'compression-release',-1)
 emit((p.funding_z<-1.5)&(p.premium_z<-1)&(p.m12<-.8)&(p.flow3>0)&(p.cl>.55),'funding-exhaustion',1);emit((p.funding_z>1.5)&(p.premium_z>1)&(p.m12>.8)&(p.flow3<0)&(p.cl<.45),'funding-exhaustion',-1)
 emit((p.r12_rank>.75)&(p.oi12_rank>.55)&(p.flow3>.03)&(p.btc_macro>-.001),'relative-momentum',1);emit((p.r12_rank<.25)&(p.oi12_rank>.55)&(p.flow3<-.03)&(p.btc_macro<.001),'relative-momentum',-1)
 emit((p.flow12<-.08)&(p.m12>-.35)&(p.cl>.6)&(p.oi3<=.002),'flow-absorption',1);emit((p.flow12>.08)&(p.m12<.35)&(p.cl<.4)&(p.oi3<=.002),'flow-absorption',-1)
 e=pd.concat(out,ignore_index=True).drop_duplicates(['symbol','time','family','side'])
 e=e.sort_values(['symbol','family','side','bar']);gap=e.groupby(['symbol','family','side']).bar.diff();e=e[gap.isna()|(gap>3)].copy()
 s=e.side.astype(float)
 for src,n in [('m1','d_m1'),('m3','d_m3'),('m12','d_m12'),('m48','d_m48'),('flow','d_flow'),('flow3','d_flow3'),('flow12','d_flow12'),('ema','d_ema'),('macro','d_macro'),('btc_r12','d_btc12'),('btc_r48','d_btc48'),('rel12','d_rel12'),('rel48','d_rel48')]:e[n]=s*e[src]
 e['crowd']=-s*e.crowd_z;e['top_crowd']=-s*e.top_z;e['position_crowd']=-s*e.pos_z;e['funding_crowd']=-s*e.funding_z;e['premium_crowd']=-s*e.premium_z;e['direction_rank']=np.where(s>0,e.r12_rank,1-e.r12_rank);e['oi_rank']=e.oi12_rank;e['flow_rank']=np.where(s>0,e.flow3_rank,1-e.flow3_rank);e['liquidity_rank']=e.q24_rank;e['close_strength']=np.where(s>0,e.cl,1-e.cl);return e.replace([np.inf,-np.inf],np.nan).sort_values(['time','symbol','family']).reset_index(drop=True)

def sim_one(f,e,x,fee,slip,delay=0):
 i=int(e.entry)+delay
 if i>=len(f)-1:return None
 side=int(e.side);raw=float(f.iloc[i].open);atr=float(e.atr);entry=raw*(1+slip*side);risk=atr*x.stop
 if not(raw>0 and atr>0 and risk<entry):return None
 stop=entry-side*risk;pt=entry+side*risk*x.partial;rt=entry+side*risk*x.runner;bt=entry+side*risk*x.be;left=1.;pnl=-entry*fee;done=False;last=i
 for j in range(i,min(len(f),i+x.hold+1)):
  b=f.iloc[j];last=j;hit=b.low<=stop if side>0 else b.high>=stop
  if hit:q=stop*(1-slip*side);pnl+=side*(q-entry)*left-q*left*fee;break
  if not done and (b.high>=pt if side>0 else b.low<=pt):
   q=pt*(1-slip*side);pnl+=side*(q-entry)*x.share-q*x.share*fee;left-=x.share;done=True
   if b.high>=bt if side>0 else b.low<=bt:stop=entry
   continue
  if done and (b.high>=rt if side>0 else b.low<=rt):q=rt*(1-slip*side);pnl+=side*(q-entry)*left-q*left*fee;break
  if done and (b.high>=bt if side>0 else b.low<=bt):stop=max(stop,entry) if side>0 else min(stop,entry)
  if j==min(len(f)-1,i+x.hold):q=float(b.close)*(1-slip*side);pnl+=side*(q-entry)*left-q*left*fee
 return {'net_r':pnl/risk,'win':int(pnl>0),'exit':last,'exit_time':f.iloc[last].time}
def simulate(e,fs,x,fee,slip,delay=0):
 r=[]
 for k,v in e.iterrows():
  o=sim_one(fs[v.symbol],v,x,fee,slip,delay)
  if o:r.append({'rid':k,**o})
 if not r:return e.iloc[0:0].copy()
 return e.join(pd.DataFrame(r).set_index('rid'),how='inner')
def matrix(e,fams=None):
 a=e[FEATURES].reset_index(drop=True);b=pd.get_dummies(e.family,prefix='f',dtype=float)
 if fams is None:fams=sorted(b.columns)
 return pd.concat([a,b.reindex(columns=fams,fill_value=0).reset_index(drop=True)],axis=1).replace([np.inf,-np.inf],np.nan).fillna(0).astype(float),fams
def deoverlap(e,score='score'):
 last={};keep=[]
 for k,r in e.sort_values(['time',score],ascending=[True,False]).iterrows():
  if int(r.entry)<=last.get(r.symbol,-1):continue
  keep.append(k);last[r.symbol]=int(r.exit)
 return e.loc[keep].sort_values('time')
def stats(e):
 if not len(e):return {'trades':0,'wins':0,'winRate':0.,'profitFactor':0.,'averageR':0.,'totalR':0.,'maxDrawdownR':0.,'positiveSymbols':0,'symbols':0}
 v=e.net_r.astype(float);gp=v[v>0].sum();gl=-v[v<0].sum();c=v.cumsum();bs=e.groupby('symbol').net_r.sum();return {'trades':len(e),'wins':int((v>0).sum()),'winRate':float((v>0).mean()),'profitFactor':float(gp/gl) if gl>EPS else float('inf'),'averageR':float(v.mean()),'medianR':float(v.median()),'totalR':float(v.sum()),'maxDrawdownR':float((c.cummax()-c).max()),'positiveSymbols':int((bs>0).sum()),'symbols':len(bs),'bySymbol':{k:round(float(x),4) for k,x in bs.items()},'byFamily':{k:round(float(x),4) for k,x in e.groupby('family').net_r.sum().items()}}
def score(s):return s['averageR']*6+math.log1p(min(s['profitFactor'],8) if math.isfinite(s['profitFactor']) else 8)+s['winRate']*2+math.log1p(s['trades'])*.15+s['positiveSymbols']*.1
def clean(x):
 if isinstance(x,dict):return {k:clean(v) for k,v in x.items()}
 if isinstance(x,list):return [clean(v) for v in x]
 if isinstance(x,float):return 'Infinity' if math.isinf(x) and x>0 else None if math.isnan(x) else round(x,6)
 return x

def main():
 a=args();root=Path(a.data_dir);syms=[x.strip().upper() for x in a.symbols.split(',') if x.strip()];start=pd.Timestamp(a.start,tz='UTC');te=pd.Timestamp(a.train_end,tz='UTC');ve=pd.Timestamp(a.validation_end,tz='UTC');he=pd.Timestamp(a.holdout_end,tz='UTC');emb=pd.Timedelta('1d');fs={};fail={}
 for s in syms:
  try:fs[s]=feat(load(root,s,start,he))
  except Exception as er:fail[s]=str(er)
 if 'BTCUSDT' not in fs or len(fs)<5:raise RuntimeError(f'insufficient datasets {list(fs)} {fail}')
 p=panelize(fs);fs={s:g.sort_values('time').reset_index(drop=True) for s,g in p.groupby('symbol')}
 for g in fs.values():g['bar']=np.arange(len(g))
 e=events(pd.concat(fs.values(),ignore_index=True));fee=.0005;slip=.0002;cands=[]
 print(json.dumps({'loadedSymbols':sorted(fs),'candidateEpisodes':len(e),'families':e.family.value_counts().to_dict()}),file=sys.stderr,flush=True)
 for ex in EXITS:
  print(f'simulating {ex.name}',file=sys.stderr,flush=True)
  o=simulate(e,fs,ex,fee,slip);tr=o[(o.time<te-emb)&(o.exit_time<te)];va=o[(o.time>=te+emb)&(o.time<ve-emb)&(o.exit_time<ve)];ho=o[(o.time>=ve+emb)&(o.time<he)]
  if len(tr)<500 or len(va)<80 or len(ho)<40 or tr.win.nunique()<2:continue
  xt,fams=matrix(tr);xv,_=matrix(va,fams);xh,_=matrix(ho,fams);w=1+np.minimum(np.abs(tr.net_r.to_numpy()),5);cl=HistGradientBoostingClassifier(max_iter=160,learning_rate=.05,max_leaf_nodes=15,min_samples_leaf=35,l2_regularization=1,random_state=42);rg=HistGradientBoostingRegressor(max_iter=160,learning_rate=.05,max_leaf_nodes=15,min_samples_leaf=35,l2_regularization=1,random_state=42);cl.fit(xt,tr.win,sample_weight=w);rg.fit(xt,tr.net_r.clip(-5,6),sample_weight=w)
  va=va.copy();ho=ho.copy();va['prob']=cl.predict_proba(xv)[:,1];va['pred']=rg.predict(xv);ho['prob']=cl.predict_proba(xh)[:,1];ho['pred']=rg.predict(xh);va['score']=va.prob+np.clip(va.pred,-2,4)/6;ho['score']=ho.prob+np.clip(ho.pred,-2,4)/6
  th=[]
  for pr in [.5,.55,.6,.65,.7,.75]:
   for rr in [-.25,0,.25,.5,.75,1]:
    q=deoverlap(va[(va.prob>=pr)&(va.pred>=rr)]);st=stats(q)
    if st['trades']>=35 and st['symbols']>=4:th.append((score(st),pr,rr,st))
  for sc,pr,rr,sv in sorted(th,reverse=True)[:3]:
   chosen=deoverlap(ho[(ho.prob>=pr)&(ho.pred>=rr)])
   cands.append({'exit':ex,'pr':pr,'rr':rr,'validationScore':sc,'validation':sv,'hold':chosen,'holdout':stats(chosen)})
 if not cands:raise RuntimeError('no validation candidate')
 finals=sorted(cands,key=lambda x:x['validationScore'],reverse=True)[:12];res=[]
 keycols=['symbol','time','family','side']
 for c in finals:
  keys=c['hold'][keycols].drop_duplicates();selected=e.merge(keys,on=keycols,how='inner')
  st=simulate(selected,fs,c['exit'],fee*2,slip*2);dl=simulate(selected,fs,c['exit'],fee,slip,1)
  for x in (st,dl):x['score']=1.
  ss=stats(deoverlap(st));ds=stats(deoverlap(dl));h=c['holdout'];ok=h['trades']>=a.minimum_holdout_trades and h['profitFactor']>2 and h['winRate']>.4 and h['averageR']>1 and h['positiveSymbols']>=4 and ss['profitFactor']>1 and ss['averageR']>0 and ds['profitFactor']>1 and ds['averageR']>0
  res.append({'id':f"meta::{c['exit'].name}::p{c['pr']}::r{c['rr']}",'exitConfig':asdict(c['exit']),'probabilityThreshold':c['pr'],'expectedRThreshold':c['rr'],'strictPass':ok,'validation':c['validation'],'holdout':h,'doubledCostsHoldout':ss,'oneBarDelayHoldout':ds})
 res.sort(key=lambda x:(x['strictPass'],x['holdout']['averageR'],x['holdout']['profitFactor'],x['holdout']['trades']),reverse=True);report={'methodology':{'source':'Binance public mirror via linxy/USDT-M_Perpetual_Futures','symbolsRequested':syms,'symbolsLoaded':sorted(fs),'loadFailures':fail,'interval':'5m','start':start.isoformat(),'trainEnd':te.isoformat(),'validationEnd':ve.isoformat(),'holdoutEnd':he.isoformat(),'embargo':'1d','events':len(e),'families':sorted(e.family.unique()),'baseCosts':{'feePerSide':fee,'slippagePerSide':slip},'gate':{'minimumTrades':a.minimum_holdout_trades,'PF':'>2','WR':'>40%','averageR':'>1','positiveSymbols':'>=4','doubledCosts':'positive','oneBarDelay':'positive'},'limitations':['fixed liquid panel, not full historical INPLAY','Coinglass heatmap unavailable without owner API key','liquidations inferred from OI collapse, impulse, volume and flow']},'strictCandidatesFound':sum(x['strictPass'] for x in res),'top':res[:10]};Path(a.output).write_text(json.dumps(clean(report),ensure_ascii=False,indent=2));print(json.dumps(clean(report),ensure_ascii=False,indent=2))
if __name__=='__main__':main()
