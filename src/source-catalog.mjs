import {addFeed,validateFeedUrl} from './source-hub.mjs';

// Public channels are optional leads, not proof of demand or guaranteed availability.
export const CATALOG=Object.freeze([
{id:'v2ex-qna',title:'V2EX · 问与答',url:'https://www.v2ex.com/feed/qna.xml',market:'中国大陆',language:'zh-CN',class:'firsthand_candidate',quality:'high',intervalMinutes:360,reason:'真实提问可能体现操作障碍；偏技术社区',caution:'问答、转载不一定是独立消费者经验'},
{id:'v2ex-life',title:'V2EX · 生活',url:'https://www.v2ex.com/feed/life.xml',market:'中国大陆',language:'zh-CN',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'生活场景与个人经验的候选线索',caution:'存在大量闲聊，需要人工筛选'},
{id:'v2ex-apple',title:'V2EX · Apple',url:'https://www.v2ex.com/feed/apple.xml',market:'中国大陆',language:'zh-CN',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'设备与应用日常使用体验',caution:'偏 Apple 社群，样本有偏差'},
{id:'ask-hn',title:'Ask HN · 公开提问',url:'https://hnrss.org/ask',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:360,reason:'寻找替代工具与开放式问题讨论',caution:'偏技术人群，问题本身不证明需求'},
{id:'superuser',title:'Super User · 数字工具问题',url:'https://superuser.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'消费者日常软件和电脑使用障碍',caution:'排障不代表愿意为新产品付费'},
{id:'webapps',title:'Web Applications · 使用问题',url:'https://webapps.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'网页应用使用痛点',caution:'平台专有问题可能不宜开发替代产品'},
// Global additions (v2.14): same firsthand-candidate bar, English-language
// communities with durable HTTPS Atom/RSS endpoints. Each implies a workaround
// or a complaint — never a verified willingness to pay.
{id:'se-lifehacks',title:'Lifehacks · 生活妙招提问',url:'https://lifehacks.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'每个已存在的变通办法都指向一个真实的日常摩擦',caution:'发帖者高度自我选择；妙招存在说明问题已有免费解法'},
{id:'se-money',title:'Money · 个人理财问题',url:'https://money.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'真实个人财务与支付场景的具体困惑',caution:'理财建议受监管敏感；问题多为一次性咨询'},
{id:'se-parenting',title:'Parenting · 育儿问题',url:'https://parenting.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'育儿与家庭场景的高摩擦日常问题',caution:'涉及儿童隐私话题需更严格的脱敏与克制'},
{id:'se-diy',title:'Home Improvement · 家居修缮问题',url:'https://diy.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'家居与维修场景的具体痛点描述',caution:'硬件类问题软件化机会有限'},
{id:'lobsters',title:'Lobsters · 技术社区精选',url:'https://lobste.rs/rss',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'高信噪比的技术讨论与工具摩擦',caution:'链接聚合为主，偏技术人群；需读评论区辨真伪'},
// Global wave 2 (v2.15): Stack Exchange consumer domains + one Russian-language
// community. Same bar — firsthand questions and experience, durable HTTPS feeds.
{id:'se-travel',title:'Travel · 旅行问题',url:'https://travel.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'签证、装备与行程中的真实摩擦，消费者购买域清晰',caution:'旅行偏好高度个人化；偶有极端个案'},
{id:'se-pets',title:'Pets · 宠物养护问题',url:'https://pets.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'宠物主人是明确的消费群体，养护问题具体',caution:'健康问题应导向兽医，不能当作产品需求证据'},
{id:'se-fitness',title:'Fitness · 健身训练问题',url:'https://fitness.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'训练、装备与习惯养成的真实困惑',caution:'建议因人而异；社区内营销内容偏多'},
{id:'se-mechanics',title:'Mechanics · 汽车养护问题',url:'https://mechanics.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'车主故障与养护描述具体且高频',caution:'硬件维修难软件化；各地法规与车型差异大'},
{id:'se-cooking',title:'Seasoned Advice · 烹饪问题',url:'https://cooking.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'厨房场景的具体问题与工具摩擦',caution:'与软件机会的关联较弱，需人工筛选'},
{id:'se-interpersonal',title:'Interpersonal Skills · 人际沟通问题',url:'https://interpersonal.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'沟通与协作场景的真实困境',caution:'多为软性问题，产品化路径不直接'},
{id:'habr-best',title:'Хабр · 俄语区最佳发布',url:'https://habr.com/ru/rss/best/daily/',market:'International',language:'ru-RU',class:'firsthand_candidate',quality:'medium',intervalMinutes:1440,reason:'俄语区技术社区的用户体验复盘与工具实践',caution:'编辑聚合偏科技职业人群；不是消费者问答社区'}
]);
export function catalogList(store){
 const feeds=store.list('feeds');
 return CATALOG.map(item=>{
  const f=feeds.find(x=>x.url===item.url);
  return {...item,installedFeedId:f?.id||null,
   status:f?.lastSuccessAt?'reachable_at_last_scan':f?.lastError?'scan_failed':'unprobed',
   verifiedLive:Boolean(f?.lastSuccessAt),lastCheckedAt:f?.lastCheckedAt||null,
   lastError:f?.lastError||null,
   notice:'RSS 连通性与需求是否真实必须分开核验'};
 });
}
export function installCatalogFeed(store,id){
 const c=CATALOG.find(x=>x.id===id);
 if(!c)throw Object.assign(new Error('目录中没有此来源'),{code:'CATALOG_NOT_FOUND',status:404});
 validateFeedUrl(c.url);
 const old=store.list('feeds').find(f=>f.url===c.url);
 if(old)return {item:old,alreadyInstalled:true};
 const f=addFeed(store,{url:c.url,title:c.title,market:c.market,intervalMinutes:c.intervalMinutes});
 return {item:store.put('feeds',{...f,catalogId:c.id,sourceClass:c.class,qualityHint:c.quality},f.revision),alreadyInstalled:false};
}
