-- 修正花蓮543 【洄瀾正藍宮】公開社團名稱，避免 Dashboard 與監測來源顯示數字 ID。
update public.facebook_pages
set page_name = '花蓮543 【洄瀾正藍宮】'
where page_url like '%1718200485104617%';

update public.articles
set source = '花蓮543 【洄瀾正藍宮】'
where platform in ('facebook_page', 'facebook_group')
  and url like '%1718200485104617%';
