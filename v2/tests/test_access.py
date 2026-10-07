"""Инвайты, заявки, пользователи: правила доступа."""

from datetime import UTC, datetime, timedelta

from app.services import access, admin, invites, users

NOW = datetime(2026, 10, 8, 12, tzinfo=UTC)


async def make_admin(session):
    return await users.ensure_admin(session, 1, "boss", "Админ")


async def test_invite_redeem_creates_user_and_counts(session) -> None:
    boss = await make_admin(session)
    inv = await invites.create(session, boss.id, max_uses=2, days=7, now=NOW)
    r = await invites.redeem(session, inv.code, 10, "a", "A", NOW)
    assert r is not None
    assert r.user.invited_by == boss.id and r.user.invite_id == inv.id and r.user.role == "user"
    assert r.invite.used == 1


async def test_invite_existing_user_does_not_spend(session) -> None:
    boss = await make_admin(session)
    inv = await invites.create(session, boss.id, max_uses=1, days=None, now=NOW)
    assert await invites.redeem(session, inv.code, 10, None, None, NOW) is not None
    assert await invites.redeem(session, inv.code, 10, None, None, NOW) is None
    await session.refresh(inv)
    assert inv.used == 1


async def test_invite_exhausted_expired_revoked_unknown(session) -> None:
    boss = await make_admin(session)
    one = await invites.create(session, boss.id, max_uses=1, days=None, now=NOW)
    assert await invites.redeem(session, one.code, 10, None, None, NOW) is not None
    assert await invites.redeem(session, one.code, 11, None, None, NOW) is None  # исчерпан

    old = await invites.create(session, boss.id, max_uses=5, days=1, now=NOW)
    assert await invites.redeem(session, old.code, 12, None, None, NOW + timedelta(days=2)) is None  # истёк

    gone = await invites.create(session, boss.id, max_uses=5, days=None, now=NOW)
    assert await invites.revoke(session, gone.id)
    assert await invites.redeem(session, gone.code, 13, None, None, NOW) is None  # отозван

    assert await invites.redeem(session, "nope", 14, None, None, NOW) is None
    assert await users.get_by_tg(session, 11) is None
    assert [i.id for i in await invites.active(session, NOW)] == [old.id]


def test_invite_payload_roundtrip() -> None:
    assert invites.code_from_payload(invites.payload("abc")) == "abc"
    assert invites.code_from_payload("i_") is None
    assert invites.code_from_payload("x_abc") is None
    assert invites.code_from_payload(None) is None
    assert invites.link("bot", "abc") == "https://t.me/bot?start=i_abc"


async def test_request_dedup_and_approve_once(session) -> None:
    boss = await make_admin(session)
    req, new = await access.request(session, 20, "r", "R")
    again, new_again = await access.request(session, 20, "r", "R")
    assert new and not new_again and again.id == req.id

    result = await access.decide(session, req.id, True, boss, NOW)
    assert result is not None
    _, user = result
    assert user is not None and user.tg_id == 20 and user.invited_by == boss.id
    # Второе нажатие (другой админ) — заявка уже решена
    assert await access.decide(session, req.id, False, boss, NOW) is None
    assert await access.pending(session) == []


async def test_request_reject_creates_nobody(session) -> None:
    boss = await make_admin(session)
    req, _ = await access.request(session, 30, None, None)
    result = await access.decide(session, req.id, False, boss, NOW)
    assert result is not None and result[1] is None
    assert await users.get_by_tg(session, 30) is None
    # После отказа можно подать заново
    _, new = await access.request(session, 30, None, None)
    assert new


async def test_block_user_but_not_admin(session) -> None:
    boss = await make_admin(session)
    req, _ = await access.request(session, 40, None, "U")
    _, u = await access.decide(session, req.id, True, boss, NOW)
    assert (await users.set_status(session, u.id, "blocked")).status == "blocked"
    assert await users.set_status(session, boss.id, "blocked") is None
    assert await users.active_tg_ids(session) == [1]
    o = await admin.overview(session, NOW)
    assert (o.users, o.blocked, o.pending) == (2, 1, 0)


async def test_set_tz_finishes_onboarding_once(session) -> None:
    u = await make_admin(session)
    await users.set_tz(session, u, "Asia/Bangkok", NOW)
    await users.set_tz(session, u, "Europe/Moscow", NOW + timedelta(days=1))
    assert u.tz == "Europe/Moscow" and u.onboarded_at == NOW


async def test_users_page_counts_profiles(session) -> None:
    from app.db.models import Profile

    u = await make_admin(session)
    session.add_all([Profile(user_id=u.id, title="Frontend"), Profile(user_id=u.id, title="QA")])
    await session.commit()
    rows, total = await users.page(session, 0)
    assert total == 1 and rows[0][1] == 2
    assert await users.profile_count(session, u.id) == 2
