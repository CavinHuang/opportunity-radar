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
{id:'habr-best',title:'Хабр · 俄语区最佳发布',url:'https://habr.com/ru/rss/best/daily/',market:'International',language:'ru-RU',class:'firsthand_candidate',quality:'medium',intervalMinutes:1440,reason:'俄语区技术社区的用户体验复盘与工具实践',caution:'编辑聚合偏科技职业人群；不是消费者问答社区'},
// Global wave 3 (v2.16): recommendation-request sites are the most direct
// tool-gap signal; gear domains, workplace friction, and Chinese/Spanish
// language coverage. Same firsthand-candidate bar throughout.
{id:'softwarerecs',title:'Software Recommendations · 软件求荐',url:'https://softwarerecs.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'high',intervalMinutes:720,reason:'整站都是「我在找能做 X 的工具」——最直接的工具缺口信号',caution:'提问不等于付费意愿；部分需求已有成熟方案'},
{id:'hardwarerecs',title:'Hardware Recommendations · 硬件求荐',url:'https://hardwarerecs.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'high',intervalMinutes:720,reason:'硬件选型困惑直接暴露产品缺口',caution:'硬件供给链重，个人机会多在配套软件与服务层'},
{id:'se-photo',title:'Photography · 摄影问题',url:'https://photo.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'摄影器材与后期流程是强消费域',caution:'器材党偏多； Gear 讨论未必指向未满足需求'},
{id:'se-bicycles',title:'Bicycles · 骑行问题',url:'https://bicycles.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'骑行装备、维护与训练的真实问题',caution:'本地化维修场景多，软件机会偏配套'},
{id:'se-outdoors',title:'The Great Outdoors · 户外问题',url:'https://outdoors.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'露营徒步等户外装备与安全决策问题',caution:'安全类话题需克制，不能拿安全痛点做营销'},
{id:'se-gardening',title:'Gardening · 园艺问题',url:'https://gardening.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'家庭园艺的场景与工具摩擦',caution:'季节性与地域气候差异大'},
{id:'se-workplace',title:'Workplace · 职场问题',url:'https://workplace.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'职场协作与流程摩擦是工具机会的重要来源',caution:'员工视角偏多；涉雇佣敏感话题需克制'},
{id:'sspai',title:'少数派 · 产品体验',url:'https://sspai.com/feed',market:'中国大陆',language:'zh-CN',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'中文世界少见的高质量产品使用体验写手社区',caution:'编辑部内容为作者视角，不是问答式消费者证言'},
{id:'es-stackoverflow',title:'Stack Overflow en Español',url:'https://es.stackoverflow.com/feeds',market:'International',language:'es',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'西语开发者问答，首个西语覆盖源',caution:'偏开发人群；与英文 SO 主题重叠'}
,{id:'ph-launches',title:'Product Hunt · 最新产品发布',url:'https://www.producthunt.com/feed',market:'International',language:'en-US',class:'competitor_trend',signalType:'competitive_launch',quality:'medium',intervalMinutes:720,reason:'追踪新产品、定位、同类供给及竞争态势；不能当作真实消费者需求',caution:'产品发布推广内容，投票数不是付费意愿；每次扫描需要验证 Atom 解析'}
,{id:'apple-askdifferent',title:'Ask Different · Apple 使用难题',url:'https://apple.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'macOS 与 iPhone 用户的实际软件使用摩擦',caution:'社区偏技术用户，排障不等于新产品机会'}
,{id:'android-enthusiasts',title:'Android Enthusiasts · Android 使用问题',url:'https://android.stackexchange.com/feeds',market:'International',language:'en-US',class:'firsthand_candidate',quality:'medium',intervalMinutes:720,reason:'Android 设备、App、同步和效率痛点',caution:'设备或系统厂商限制可能没有第三方解决方案'}
,{id:'ux-stackexchange',title:'User Experience · 产品交互问题',url:'https://ux.stackexchange.com/feeds',market:'International',language:'en-US',class:'professional_discussion',signalType:'design_friction',quality:'medium',intervalMinutes:720,reason:'发现软件使用流程与交互设计的摩擦',caution:'设计专业人士讨论不能直接视为消费者访谈'}
,{id:'reddit-research',title:'Reddit · 海外社区需求观察',url:'https://www.reddit.com/',market:'International',language:'en-US',class:'manual_research',signalType:'firsthand_candidate',accessMode:'manual',quality:'high',reason:'在 r/SideProject、r/SaaS、r/Entrepreneur、r/selfhosted、r/productivity 中寻找用户原话和现有替代方案',caution:'Reddit 官方将于 2026-11-13 停止 RSS，未经授权不得抓取。请打开官方站点核查并手动保存帖子 URL'}
,{id:'x-social',title:'X.com · 海外产品痛点与趋势',url:'https://x.com/explore',market:'International',language:'en-US',class:'manual_research',signalType:'social_discussion',accessMode:'manual',quality:'medium',reason:'关注用户对 AI、开发者工具、效率软件的抱怨、替代品和产品更新',caution:'默认只允许手动保存帖子链接；自动搜索需要单独获得官方 API 授权、预算和速率额度'}

,{id:'openrss-reddit-saas',title:'Open RSS · Reddit r/SaaS（实验）',url:'https://openrss.org/www.reddit.com/r/SaaS/',market:'International',language:'en-US',class:'firsthand_candidate',signalType:'social_discussion',accessMode:'experimental_rss',provider:'openrss',quality:'experimental',intervalMinutes:1440,reason:'第三方聚合 Reddit SaaS 社区讨论；需要逐条验证原帖与来源授权',caution:'非 Reddit 官方接口；Reddit RSS 将于 2026-11-13 停止，第三方服务可能随时不可用或受访问政策影响'}
,{id:'openrss-reddit-sideproject',title:'Open RSS · Reddit r/SideProject（实验）',url:'https://openrss.org/www.reddit.com/r/SideProject/',market:'International',language:'en-US',class:'firsthand_candidate',signalType:'social_discussion',accessMode:'experimental_rss',provider:'openrss',quality:'experimental',intervalMinutes:1440,reason:'第三方社区项目讨论线索，发现开发者的实际问题和替代工具需求',caution:'地址与访问可用性需要实测；不保证在 Reddit RSS 退役后继续工作'}
,{id:'rsshub-x-diygod',title:'RSSHub · X 用户动态（实验示例）',url:'https://rsshub.app/twitter/user/DIYgod',market:'International',language:'en-US',class:'social_discussion',signalType:'social_discussion',accessMode:'experimental_rss',provider:'rsshub',quality:'experimental',intervalMinutes:1440,reason:'展示第三方 X 帖子转 RSS 的可选接入方式，适合跟踪公开工具资讯',caution:'公共 RSSHub X 路由可能要求认证或失效；不保证稳定；仅在已获授权且符合平台规则时订阅'}

]);
export function catalogList(store){
 const feeds=store.list('feeds');
 return CATALOG.map(item=>{
  const f=item.accessMode==='manual'?null:feeds.find(x=>x.url===item.url);
  return {...item,accessMode:item.accessMode||'rss',installedFeedId:f?.id||null,
   status:f?.lastSuccessAt?'reachable_at_last_scan':f?.lastError?'scan_failed':'unprobed',
   verifiedLive:Boolean(f?.lastSuccessAt),lastCheckedAt:f?.lastCheckedAt||null,
   lastError:f?.lastError||null,
   notice:'RSS 连通性与需求是否真实必须分开核验'};
 });
}
export function installCatalogFeed(store,id,{acceptExperimentalRisk=false}={}){
 const c=CATALOG.find(x=>x.id===id);
 if(!c)throw Object.assign(new Error('目录中没有此来源'),{code:'CATALOG_NOT_FOUND',status:404});
 if(c.accessMode==='manual')throw Object.assign(new Error('此平台暂不提供可持续的公开 RSS 接入；请打开来源页面并使用手动保存网页线索'),{code:'CATALOG_MANUAL_ONLY',status:409});
 if(c.accessMode==='experimental_rss'&&acceptExperimentalRisk!==true)throw Object.assign(new Error('第三方 RSS 未经持续可用性验证，请确认其访问条件和风险后再订阅'),{code:'EXPERIMENTAL_SOURCE_CONFIRMATION_REQUIRED',status:409});
 validateFeedUrl(c.url);
 const old=store.list('feeds').find(f=>f.url===c.url);
 if(old)return {item:old,alreadyInstalled:true};
 const f=addFeed(store,{url:c.url,title:c.title,market:c.market,intervalMinutes:c.intervalMinutes});
 return {item:store.put('feeds',{...f,catalogId:c.id,sourceClass:c.class,qualityHint:c.quality,accessMode:c.accessMode||'rss',provider:c.provider||'native',sourceCaution:c.caution},f.revision),alreadyInstalled:false};
}
