-- 修正既有 Facebook 監測來源名稱，避免 Dashboard 以數字 ID 顯示。
update public.facebook_pages
set page_name = '花蓮人Hualien'
where page_url like '%265344726961368%';

update public.facebook_pages
set page_name = '花蓮大小事'
where page_url like '%255935524557211%';

update public.facebook_pages
set page_name = '花蓮同鄉會'
where page_url like '%249927231705630%';

update public.facebook_pages
set page_name = '花蓮爆料王'
where page_url like '%833233640557210%';

update public.facebook_pages
set page_name = '今日花蓮'
where page_url like '%100063596289388%';

-- 依貼文 URL 重新校正已寫入 articles 的 Facebook 來源名稱。
update public.articles
set source = '花蓮人Hualien'
where platform in ('facebook_page', 'facebook_group')
  and url like '%265344726961368%';

update public.articles
set source = '花蓮大小事'
where platform in ('facebook_page', 'facebook_group')
  and url like '%255935524557211%';

update public.articles
set source = '花蓮同鄉會'
where platform in ('facebook_page', 'facebook_group')
  and url like '%249927231705630%';

update public.articles
set source = '花蓮爆料王'
where platform in ('facebook_page', 'facebook_group')
  and url like '%833233640557210%';

update public.articles
set source = '今日花蓮'
where platform in ('facebook_page', 'facebook_group')
  and url like '%100063596289388%';
