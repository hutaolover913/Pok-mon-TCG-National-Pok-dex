import requests, json, re, time, html, io, zipfile, hashlib, sys
from pathlib import Path
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'exports' / 'missing_images'
OUT.mkdir(parents=True, exist_ok=True)
CACHE = OUT / 'sources'
CACHE.mkdir(exist_ok=True)

def get(url, params=None):
    r = requests.get(url, params=params, timeout=25)
    r.raise_for_status()
    return r

BASE = 'https://www.tcgcollector.com'
ROWS = json.loads((ROOT/'data/pipeline/logs/final_still_missing.json').read_text(encoding='utf-8'))

def cached(url, key):
    path = CACHE/(key+'.html')
    if path.exists(): return path.read_text(encoding='utf-8')
    time.sleep(.6)
    r = get(url)
    path.write_text(r.text,encoding='utf-8')
    return r.text

def indexes():
    result = {}
    for lang,slug in [('ja','jp'),('en','intl')]:
        s = BeautifulSoup(cached(BASE+'/sets/'+slug,'collector_'+('jp' if lang=='ja' else 'en')),'html.parser')
        for b in s.select('[data-set-name]'):
            p = b.find_parent(class_='set-logo-grid-item')
            code = p.select_one('.set-logo-grid-item-code') if p else None
            if code:
                result[(lang,code.get_text(strip=True),b['data-set-name'])] = {
                    'code':code.get_text(strip=True),'name':b['data-set-name'],
                    'url':BASE+'/sets/'+b['data-set-id']+'/'+b['data-set-slug'],
                    'id':b['data-set-id'], 'language':lang}
    return result

def parse_set(meta):
    try:
        raw = cached(meta['url'],'set_'+meta['id'])
        s = BeautifulSoup(raw,'html.parser')
        items = []
        for item in s.select('.card-image-grid-item'):
            a=item.select_one('.card-image-grid-item-link')
            im=item.select_one('.card-image-grid-item-image')
            n=item.select_one('.card-image-grid-item-info-overlay-number')
            if not a or not im or not n: continue
            srcset=im.get('srcset','')
            image=srcset.split(',')[-1].strip().split(' ')[0] if srcset else im.get('src','')
            items.append({'number':n.get_text(strip=True),'title':a.get('title',''),
                'sourceUrl':urljoin(BASE,a['href']),'imageUrl':image,'setName':meta['name'],
                'setCode':meta['code'],'language':meta['language']})
        print('SET',meta['language'],meta['code'],len(items),flush=True)
        return meta,items,None
    except Exception as e:
        print('FAILED',meta['code'],type(e).__name__,flush=True)
        return meta,[],str(e)

def norm(x):
    x=x.split('/')[0].strip()
    x=re.sub(r'^No\.\s*','',x)
    return re.sub(r'(?<!\d)0+(?=\d)','',x).lower()

def main():
    idx=indexes()
    wanted={}
    for row in ROWS:
        code={'M-P':'MP','SV-P':'SVP','swshp':'SSP','svp':'SVP','mep':'MEP'}.get(row['setId'],row['setId'])
        for (lang,c,name),meta in idx.items():
            if lang != row['language']: continue
            if row['setId']=='mfb' and name.startswith('My First Battle ('):
                wanted[meta['id']]=meta
            elif c==code and name!='Miscellaneous Promos':
                if row['setId']=='swshp' and name!='Sword & Shield Promos': continue
                wanted[meta['id']]=meta
    with ThreadPoolExecutor(max_workers=3) as pool:
        found=list(pool.map(parse_set,wanted.values()))
    catalog=[]
    for meta,items,error in found: catalog.extend(items)
    raw=cached(BASE+'/cards/intl?cardSearch=Pikachu%20at%20the%20Museum','special_museum')
    s=BeautifulSoup(raw,'html.parser')
    for item in s.select('.card-image-grid-item'):
        a=item.select_one('.card-image-grid-item-link'); im=item.select_one('.card-image-grid-item-image')
        if a and im and a.get('title','').startswith('Pikachu at the Museum (Mega Evolution Promos'):
            image=im.get('srcset','').split(',')[-1].strip().split(' ')[0] or im.get('src','')
            catalog.append({'number':'No. 500','title':a['title'],'sourceUrl':urljoin(BASE,a['href']),
                'imageUrl':image,'setName':'Mega Evolution Promos','setCode':'MEP','language':'en'})
    (OUT/'source_catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2),encoding='utf-8')
    print('CATALOG',len(catalog),flush=True)
    results=[]
    sets=json.loads((ROOT/'data/sets.json').read_text(encoding='utf-8'))
    for row in ROWS:
        r=dict(row)
        r['setName']=sets.get(row['language']+':'+row['setId'],{}).get('setName',row['setId'])
        code={'M-P':'MP','SV-P':'SVP','swshp':'SSP','svp':'SVP','mep':'MEP'}.get(row['setId'],row['setId'])
        if row['cardId']=='tcgdex:en:mep-Museum':
            matches=[dict(c) for c in catalog if c['title'].startswith('Pikachu at the Museum (') and c['language']=='en']
            r['status']='候選版本需核對' if matches else '未找到'
            r['note']='無印刷卡號的 Jumbo 大卡；TCGdex 用 Museum，來源用 No. 500，均為資料庫識別值。卡包與名稱一致。'
        elif row['cardId']=='tcgdex:en:svp-500':
            matches=[dict(c) for c in catalog if c['title'].startswith('Terapagos & Friends (') and c['language']=='en' and c['setCode']=='SVP']
            r['status']='候選版本需核對' if matches else '未找到'
            r['note']='無印刷卡號的 Jumbo 大卡；500／No. 500 為資料庫識別值。卡包與名稱一致，需核對語言及 Horizons 標誌。'
        elif row['setId']=='MC' and row['cardNumber'] in ['DAR','FIG','FIR','GRA','LIG','MET','PSY','WAT']:
            energy={'DAR':'Darkness','FIG':'Fighting','FIR':'Fire','GRA':'Grass','LIG':'Lightning','MET':'Metal','PSY':'Psychic','WAT':'Water'}[row['cardNumber']]
            matches=[dict(c) for c in catalog if c['language']=='ja' and c['setCode']=='MC' and c['title'].split(' (')[0]=='Basic '+energy+' Energy']
            r['status']='候選版本需核對' if matches else '未找到'
            r['note']='基本能量未採用一般印刷卡號：TCGdex 用類型代碼，來源用 No. 1000–1007。卡包與能量類型一致，仍需核對圖面及版本。'
        elif row['setId']=='mfb':
            alias={'Grass Energy':'Basic Grass Energy','Fire Energy':'Basic Fire Energy','Lightning Energy':'Basic Lightning Energy','Water Energy':'Basic Water Energy'}
            name=alias.get(row['name'],row['name'])
            matches=[dict(c) for c in catalog if c['language']=='en' and c['setName'].startswith('My First Battle (') and c['title'].split(' (')[0]==name]
            r['status']='候選版本需核對' if matches else '未找到'
            r['note']='TCGdex 的 1–34 為整體清單編號；來源按四副牌各自編號。同名卡含 First Pokémon 藍框、一般卡或不同編號，列出全部候選，不擅自指定版本。'
        else:
            matches=[dict(c) for c in catalog if c['language']==row['language'] and c['setCode']==code and norm(c['number'])==norm(row['cardNumber'])]
            if row['setId']=='swshp': matches=[c for c in matches if c['setName']=='Sword & Shield Promos']
            # English names can be checked directly. Japanese source titles are translated;
            # retain both names and document that matching uses set and printed number.
            if row['language']=='en':
                matches=[c for c in matches if re.sub(r'[^a-z0-9]','',c['title'].split(' (')[0].lower())==re.sub(r'[^a-z0-9]','',row['name'].lower())]
            r['status']='卡包／卡號已核對' if matches else '未找到'
            r['note']='來源卡包與印刷卡號一致；保留來源英文卡名，供圖面核對。' if row['language']=='ja' else '來源卡包、卡號與英文卡名一致。'
        r['candidates']=list({c['sourceUrl']:c for c in matches}.values())
        results.append(r)
    (OUT/'missing_images_report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    counts={status:sum(r['status']==status for r in results) for status in set(r['status'] for r in results)}
    print(json.dumps(counts,ensure_ascii=True),flush=True)
    print('UNRESOLVED',json.dumps([(r['cardId'],r['name']) for r in results if not r['candidates']],ensure_ascii=True),flush=True)
    package(results)

def download(job):
    r,c,i=job
    folder='matched' if r['status']=='卡包／卡號已核對' else 'candidates'
    filename=r['cardId'].replace('tcgdex:','').replace(':','_')+ ('__'+str(i+1) if folder=='candidates' else '')+'.jpg'
    rel='images/'+folder+'/'+filename
    if c.get('localPath'): rel=c['localPath']
    p=OUT/rel
    try:
        if p.exists(): raw=p.read_bytes()
        else:
            time.sleep(.6)
            raw=get(c['imageUrl']).content
        image=Image.open(io.BytesIO(raw))
        image.verify()
        image=Image.open(io.BytesIO(raw))
        if image.width<200 or image.height<280: raise ValueError('圖片尺寸不足，可能為替代圖')
        # Keep original image bytes; extension follows decoded format.
        ext={'JPEG':'jpg','PNG':'png','WEBP':'webp'}.get(image.format)
        if not ext: raise ValueError('不支援的圖片格式')
        rel=str(Path(rel).with_suffix('.'+ext)).replace('\\','/')
        p=OUT/rel
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(raw)
        c.update(localPath=rel,width=image.width,height=image.height,sha256=hashlib.sha256(raw).hexdigest(),downloadStatus='已下載並通過圖片解碼檢查')
    except Exception as e:
        c.update(downloadStatus='下載失敗',downloadError=str(e))
    return c

def package(results):
    jobs=[(r,c,i) for r in results for i,c in enumerate(r['candidates'])]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for n,_ in enumerate(pool.map(download,jobs),1):
            if n%20==0: print('IMAGES',n,'/',len(jobs),flush=True)
    counts={status:sum(r['status']==status for r in results) for status in ['卡包／卡號已核對','候選版本需核對','未找到']}
    summary={'checkedAt':'2026-09-12','totalCards':len(results),'byStatus':counts,
        'cardsWithDownloadedImages':sum(any(c.get('localPath') for c in r['candidates']) for r in results),
        'downloadedImageFiles':sum(bool(c.get('localPath')) for r in results for c in r['candidates']),
        'downloadFailures':sum(c.get('downloadStatus')=='下載失敗' for r in results for c in r['candidates'])}
    (OUT/'missing_images_report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    render_report(results,summary)
    readme='''# 缺圖整理包\n\n開啟 index.html 可搜尋卡名、卡包與卡號，查看圖片及來源連結。\n\nimages/matched：來源卡包與印刷卡號一致的圖片；日文卡同時保留來源翻譯英文卡名供核對。\nimages/candidates：My First Battle、MC 基本能量與無編號 Jumbo 卡，來源編號方式不同，需核對圖面及版本。檔名 __1、__2 只是候選順序，不代表優先度。\n\n原始缺圖清單、原因及人工查詢連結均保留在 missing_images_report.json。每張圖片附來源頁、圖片網址、解碼尺寸及 SHA-256。\n\n在 App 找到對應卡片詳細頁，使用手動上傳功能選擇圖片。上傳存於該瀏覽器 IndexedDB，不包含在 App 的 JSON 備份中；請保留此包。\n\n本次只整理檔案，未修改 App 的卡片資料或圖片對照表。圖片權利屬原權利人，來源均為公開卡片資料頁。\n'''
    (OUT/'README.md').write_text(readme,encoding='utf-8')
    zpath=OUT.parent/'missing_images_package.zip'
    paths=[OUT/'index.html',OUT/'README.md',OUT/'missing_images_report.json',OUT/'summary.json']
    paths += [OUT/c['localPath'] for r in results for c in r['candidates'] if c.get('localPath')]
    with zipfile.ZipFile(zpath,'w',zipfile.ZIP_DEFLATED) as z:
        for p in dict.fromkeys(paths): z.write(p,p.relative_to(OUT))
    print('SUMMARY',json.dumps(summary,ensure_ascii=True),flush=True)

def render_report(results,summary):
    esc=lambda x:html.escape(str(x),quote=True)
    rows=[]
    for r in results:
        imgs=[]
        for c in r['candidates']:
            preview='<a href="'+esc(c['localPath'])+'"><img loading="lazy" src="'+esc(c['localPath'])+'" alt="'+esc(c['title'])+'"></a>' if c.get('localPath') else '<p>圖片未下載成功</p>'
            imgs.append('<div class="candidate">'+preview+'<p>'+esc(c['title'])+'</p><a target="_blank" rel="noopener" href="'+esc(c['sourceUrl'])+'">來源詳細頁</a> · <a target="_blank" rel="noopener" href="'+esc(c['imageUrl'])+'">原始圖片</a></div>')
        rows.append('<tr data-status="'+esc(r['status'])+'"><td><b>'+esc(r['name'])+'</b><p>'+esc(r['cardId'])+'</p></td><td>'+esc(r['setName'])+'<p>'+esc(r['setId'])+'</p></td><td>'+esc(r['cardNumber'])+'</td><td>'+('日文' if r['language']=='ja' else '英文')+'</td><td><b>'+esc(r['status'])+'</b><p>'+esc(r['note'])+'</p><details><summary>原缺圖原因</summary>'+esc(r['reason'])+'</details><p><a target="_blank" rel="noopener" href="'+esc(r['manualCheckUrl'])+'">原人工查詢連結</a></p></td><td><div class="gallery">'+''.join(imgs)+'</div></td></tr>')
    content='''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>圖鑑缺圖整理</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#202c3b;background:#f3f6fa;margin:24px}h1{margin-bottom:6px}p{margin:6px 0}a{color:#145eac}header{background:white;padding:20px;border-radius:12px;margin-bottom:18px}input,select{font:inherit;padding:9px;margin:12px 8px 8px 0;border:1px solid #a9b7c7;border-radius:6px}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;border:1px solid #dbe2eb;text-align:left;vertical-align:top}th{background:#e6edf6}td:first-child{min-width:170px}td:nth-child(5){min-width:220px}.gallery{display:flex;gap:14px;flex-wrap:wrap}.candidate{width:170px;font-size:12px;overflow-wrap:anywhere}.candidate img{width:160px;height:224px;object-fit:contain}details{font-size:13px}.tablewrap{overflow:auto}footer{margin:16px 0;font-size:13px}</style><header><h1>圖鑑缺圖整理</h1><p>核對日期：2026-09-12 · 共 184 張。卡包／卡號已核對：COUNT_MATCHED 張；候選版本需核對：COUNT_CANDIDATES 張；未找到：COUNT_MISSING 張。</p><p>已下載 DOWNLOADS 個圖片檔，涵蓋 COVERED 張卡片。點圖片可開啟本機檔案，供 App 詳細頁手動上傳。</p><p>候選版本包含 My First Battle 同名不同版本、MC 無一般卡號的基本能量，以及無編號 Jumbo 卡。請依來源文字及圖面選擇。日文卡來源標題使用英文翻譯。</p><input id="q" aria-label="搜尋清單" placeholder="搜尋卡名、卡包、卡號"><select id="status" aria-label="核對狀態"><option value="">全部狀態</option><option>卡包／卡號已核對</option><option>候選版本需核對</option><option>未找到</option></select><span id="count"></span></header><div class="tablewrap"><table><thead><tr><th>卡名／ID</th><th>卡包</th><th>清單卡號</th><th>語言</th><th>核對結果與說明</th><th>圖片與來源</th></tr></thead><tbody>ROWS</tbody></table></div><footer>圖片來源：TCG Collector 公開卡片資料頁。原始缺圖原因與查詢連結皆保留。整理結果未寫入 App。上傳图片僅存在該瀏覽器，請保留圖片包備份。</footer><script>const rows=[...document.querySelectorAll('tbody tr')],q=document.getElementById('q'),s=document.getElementById('status');function filter(){let n=0;for(const r of rows){const show=r.textContent.toLowerCase().includes(q.value.toLowerCase())&&(!s.value||r.dataset.status===s.value);r.hidden=!show;if(show)n++;}document.getElementById('count').textContent='顯示 '+n+' / '+rows.length+' 張';}q.addEventListener('input',filter);s.addEventListener('change',filter);filter();</script></html>'''
    for key,value in {'COUNT_MATCHED':summary['byStatus']['卡包／卡號已核對'],'COUNT_CANDIDATES':summary['byStatus']['候選版本需核對'],'COUNT_MISSING':summary['byStatus']['未找到'],'DOWNLOADS':summary['downloadedImageFiles'],'COVERED':summary['cardsWithDownloadedImages'],'ROWS':''.join(rows)}.items(): content=content.replace(key,str(value))
    (OUT/'index.html').write_text(content,encoding='utf-8')

def special_probe():
    for key,url in [('special_museum',BASE+'/cards/intl?cardSearch=Pikachu%20at%20the%20Museum'),('special_terapagos','https://tcgnav.com/carta.php?id=svp-500&lang=en')]:
        try:
            raw=cached(url,key)
            print(key,len(raw),flush=True)
        except Exception as e: print(key,type(e).__name__,flush=True)

if __name__ == '__main__':
    if '--special' in sys.argv: special_probe()
    elif '--package' in sys.argv:
        results=json.loads((OUT/'missing_images_report.json').read_text(encoding='utf-8'))
        for r in results: r['candidates']=list({c['sourceUrl']:c for c in r['candidates']}.values())
        package(results)
    else: main()
