// W9 · Gate views — письма, которые «Gate» просит перерисовать (нажали 🚀, а робот ждёт) → по item на «View».
// Нода: Code, режим «Run Once for All Items».
return ($('Gate').first().json.views ?? []).map((v) => ({ json: v }));
