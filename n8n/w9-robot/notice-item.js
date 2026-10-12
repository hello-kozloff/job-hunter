// W9 · Notice item — сообщение к отправке (от «Gate» или «Captcha plan») — один item, на него ссылаются ноды ниже.
// Нода: Code, режим «Run Once for All Items». Выход: { notice }
return [{ json: { notice: $input.first().json.notice } }];
