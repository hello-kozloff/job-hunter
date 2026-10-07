from app.services import users


async def test_ensure_admin_is_idempotent(session) -> None:
    first = await users.ensure_admin(session, 111, "nik", "Никита")
    again = await users.ensure_admin(session, 111, "nik2", "Никита")
    assert first.id == again.id
    assert again.role == "admin"
    assert (await users.get_by_tg(session, 111)).username == "nik2"
    assert await users.get_by_tg(session, 222) is None
