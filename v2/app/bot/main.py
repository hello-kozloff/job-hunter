"""Бот v2: long polling (публичный адрес не нужен). Запуск: python -m app.bot.main"""

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.types import BotCommand, BotCommandScopeChat, BotCommandScopeDefault

from app.bot.middlewares import DbUserMiddleware
from app.bot.routers import admin, fallback, onboarding, start
from app.config import get_settings

log = logging.getLogger("bot")


async def set_commands(bot: Bot) -> None:
    """Меню команд: всем — /start, /tz; администратору из .env — ещё /admin."""
    common = [BotCommand(command="start", description="Главная"), BotCommand(command="tz", description="Часовой пояс")]
    await bot.set_my_commands(common, scope=BotCommandScopeDefault())
    admin_id = get_settings().admin_tg_id
    if admin_id:
        admin = [*common, BotCommand(command="admin", description="Администрирование")]
        await bot.set_my_commands(admin, scope=BotCommandScopeChat(chat_id=admin_id))


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    token = get_settings().tg_bot_token
    if not token:
        # Без токена не падаем в цикл перезапусков: ждём, пока TG_BOT_TOKEN появится в v2/.env и контейнер пересоздадут
        log.warning("TG_BOT_TOKEN пуст — бот не запущен (создай бота в @BotFather и впиши токен в v2/.env)")
        await asyncio.Event().wait()
    bot = Bot(token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dp = Dispatcher()
    # Сессия базы и пользователь — во все обработчики; FSM пока в памяти (сбрасывается при перезапуске бота)
    dp.update.outer_middleware(DbUserMiddleware())
    # Порядок важен: fallback — последним
    dp.include_routers(start.router, onboarding.router, admin.router, fallback.router)
    await set_commands(bot)
    await bot.delete_webhook(drop_pending_updates=False)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
