// W3 · Locked job — письмо уже пишется: второе нажатие ✅ или «🔄» не должно запустить второй W5 (07.10.2026).
// Нода: Code, режим «Run Once for All Items». Вход: «Letter lock» — строка, если захват удался (letter_lock был пуст);
// пустой выход «Letter lock» — письмо уже пишется, эта нода не выполняется и W5 не вызывается.
// Выход: задание из «Letter job» → «Write letter». W5 снимает letter_lock в конце (нода «Unlock»).

return [$('Letter job').first()];
