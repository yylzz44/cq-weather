# -*- coding: utf-8 -*-
"""
重庆气象专报 · 每日数据自动更新脚本
数据来源：中央气象台（NMC）官方接口 + 重庆市规划和自然资源局
由 GitHub Actions 定时运行，成功后覆盖仓库根目录的 data.json
网页打开时会自动读取最新的 data.json（无需改动 index.html）
"""
import json, re, time, sys, urllib.request
from datetime import datetime, timezone, timedelta

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'}
CN = timezone(timedelta(hours=8))

def fetch(url, referer='http://www.nmc.cn/'):
    h = dict(UA); h['Referer'] = referer
    req = urllib.request.Request(url, headers=h)
    return urllib.request.urlopen(req, timeout=25).read().decode('utf-8', 'ignore')

# ---------- 38区县 -> NMC站点 ----------
STATION_MAP = {
 '万州区':'万州','涪陵区':'涪陵','渝中区':'重庆','大渡口区':'重庆','江北区':'重庆',
 '沙坪坝区':'沙坪坝','九龙坡区':'重庆','南岸区':'重庆','北碚区':'北碚','綦江区':'綦江',
 '大足区':'大足','渝北区':'两江新区','巴南区':'巴南','黔江区':'黔江','长寿区':'长寿',
 '江津区':'江津','合川区':'合川','永川区':'永川','南川区':'南川','璧山区':'璧山',
 '铜梁区':'铜梁','潼南区':'潼南','荣昌区':'荣昌','开州区':'开州','梁平区':'梁平',
 '武隆区':'武隆','城口县':'城口','丰都县':'丰都','垫江县':'垫江','忠县':'忠县',
 '云阳县':'云阳','奉节县':'奉节','巫山县':'巫山','巫溪县':'巫溪',
 '石柱土家族自治县':'石柱','秀山土家族苗族自治县':'秀山',
 '酉阳土家族苗族自治县':'酉阳','彭水苗族土家族自治县':'彭水',
}
SHORT = {'万州':'万州区','涪陵':'涪陵区','渝中':'渝中区','大渡口':'大渡口区','江北':'江北区',
 '沙坪坝':'沙坪坝区','九龙坡':'九龙坡区','南岸':'南岸区','北碚':'北碚区','綦江':'綦江区',
 '大足':'大足区','渝北':'渝北区','两江新区':'渝北区','巴南':'巴南区','黔江':'黔江区',
 '长寿':'长寿区','江津':'江津区','合川':'合川区','永川':'永川区','南川':'南川区',
 '璧山':'璧山区','铜梁':'铜梁区','潼南':'潼南区','荣昌':'荣昌区','开州':'开州区',
 '梁平':'梁平区','武隆':'武隆区','城口':'城口县','丰都':'丰都县','垫江':'垫江县',
 '忠县':'忠县','云阳':'云阳县','奉节':'奉节县','巫山':'巫山县','巫溪':'巫溪县',
 '石柱':'石柱土家族自治县','秀山':'秀山土家族苗族自治县','酉阳':'酉阳土家族苗族自治县',
 '彭水':'彭水苗族土家族自治县','万盛':'万盛经开区'}
LV_ORD = {'红色':4,'橙色':3,'黄色':2,'蓝色':1}

def clean(s):
    return None if s in ('9999', 9999, '', '-') else s

def get_station_codes():
    prov = json.loads(fetch('http://www.nmc.cn/rest/province/ACQ'))
    return {p['city']: p['code'] for p in prov}

def get_city_weather(code):
    return json.loads(fetch(f'http://www.nmc.cn/rest/weather?stationid={code}'))['data']

def get_alarms():
    alarms = []
    for page in (1, 2, 3):
        u = ('http://www.nmc.cn/rest/findAlarm?pageNo=%d&pageSize=20&signaltype='
             '&signallevel=&province=%%E9%%87%%8D%%E5%%BA%%86%%E5%%B8%%82' % page)
        r = json.loads(fetch(u))
        lst = r['data']['page']['list']
        if not lst:
            break
        alarms += lst
        if len(lst) < 20:
            break
        time.sleep(0.4)
    return alarms

def alarm_detail(url):
    try:
        html = fetch('http://www.nmc.cn' + url)
        m = re.search(r'<div class="alarm-desc[^"]*"[^>]*>(.*?)</div>', html, re.S)
        if not m:
            m = re.search(r'<p[^>]*>([^<]{80,800})</p>', html)
        return re.sub(r'<[^>]+>', '', m.group(1)).strip() if m else ''
    except Exception:
        return ''

def parse_alert(a):
    t = a['title']
    m = re.search(r'发布(\S+?)(红色|橙色|黄色|蓝色)预警', t)
    atype, level = (m.group(1), m.group(2)) if m else ('预警', '')
    atype = atype.replace('信号', '').replace('预警', '')
    dist = next((v for k, v in SHORT.items() if k in t), None)
    return {'title': t, 'time': a['issuetime'], 'type': atype, 'level': level,
            'district': dist, 'city_level': '市气象台' if '重庆市气象台' in t else '区县气象台',
            'detail': a.get('detail', '')}

def get_dzzy_link(today):
    """今日地灾预警图官方页面链接（找不到则回退到栏目页）"""
    fallback = 'https://ghzrzyj.cq.gov.cn/ztlm_186/dzzhyjt/'
    try:
        html = fetch(fallback, referer='https://ghzrzyj.cq.gov.cn/')
        ymd = today.strftime('%Y%m%d')
        links = re.findall(r'href="(\./\d{6}/t%s_\d+\.html)"' % ymd, html)
        if links:
            return 'https://ghzrzyj.cq.gov.cn/ztlm_186/dzzhyjt/' + links[0][2:]
    except Exception:
        pass
    return fallback

def main():
    now = datetime.now(CN)
    codes = get_station_codes()

    weather = {}
    for city in set(STATION_MAP.values()):
        try:
            weather[city] = get_city_weather(codes[city])
            time.sleep(0.25)
        except Exception as e:
            print('weather fail:', city, e, file=sys.stderr)

    districts = []
    for gname, st in STATION_MAP.items():
        d = weather.get(st)
        if not d:
            continue
        w, wind = d['real']['weather'], d['real']['wind']
        fc = [{'date': day['date'],
               'day_info': clean(day['day']['weather']['info']),
               'day_t': clean(day['day']['weather']['temperature']),
               'night_info': clean(day['night']['weather']['info']),
               'night_t': clean(day['night']['weather']['temperature']),
               'wind_d': clean(day['day']['wind']['direct']),
               'wind_p': clean(day['day']['wind']['power'])}
              for day in d['predict']['detail'][:7]]
        districts.append({'n': gname, 'st': st,
            't': clean(w['temperature']), 'feel': clean(w['feelst']),
            'hum': clean(w['humidity']), 'info': clean(w['info']),
            'rain': clean(w['rain']), 'wind_d': clean(wind['direct']),
            'wind_p': clean(wind['power']), 'pub': d['real']['publish_time'], 'fc': fc})

    raw = get_alarms()
    for a in raw:
        a['detail'] = alarm_detail(a['url'])
        time.sleep(0.15)
    alerts = [parse_alert(a) for a in raw]

    data = {
        'updated': now.strftime('%Y-%m-%d %H:%M'),
        'city_pub': weather.get('重庆', {}).get('predict', {}).get('publish_time', ''),
        'districts': districts,
        'alerts': alerts,
        'sources': [
            {'name': '中央气象台（NMC）', 'url': 'http://www.nmc.cn'},
            {'name': '中国气象局', 'url': 'http://weather.cma.cn'},
            {'name': '重庆市规划和自然资源局·地质灾害预警',
             'url': 'https://ghzrzyj.cq.gov.cn/ztlm_186/dzzhyjt/'},
        ],
        'dzzy_today': get_dzzy_link(now),
    }
    if len(districts) < 30:
        print('too few districts, abort', file=sys.stderr)
        sys.exit(1)
    with open('data.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print('OK:', len(districts), 'districts,', len(alerts), 'alerts, updated', data['updated'])

if __name__ == '__main__':
    main()
