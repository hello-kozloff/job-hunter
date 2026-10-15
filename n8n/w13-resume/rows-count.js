// W13 · Rows count — строки вакансий прочитаны («Vacancies» отдаёт по item на строку): дальше идёт один item.
// Нода: Code, режим «Run Once for All Items». Сами строки «Step» берёт из «Vacancies» — покрытие навыков.

return [{ json: { rows: $input.all().filter((i) => i.json?.id).length } }];
