import { eq, and, inArray, sql, desc, or, isNull, isNotNull } from "drizzle-orm";
import db from "../db";
import { usersTable, marketsTable, marketOutcomesTable, betsTable } from "../db/schema";
import { hashPassword, verifyPassword } from "../lib/auth";
import {
  validateRegistration,
  validateLogin,
  validateMarketCreation,
  validateBet,
} from "../lib/validation";

export async function handleRegister(context: any) {
  const { body, jwt, set } = context;
  const { username, email, password } = body;
  const errors = validateRegistration(username, email, password);

  if (errors.length > 0) {
    set.status = 400;
    return { errors };
  }

  const existingUser = await db.query.usersTable.findFirst({
    where: or(eq(usersTable.email, email), eq(usersTable.username, username)),
  });

  if (existingUser) {
    set.status = 409;
    return { errors: [{ field: "email", message: "User already exists" }] };
  }

  const passwordHash = await hashPassword(password);
  const adminEmails = new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const adminUsernames = new Set(
    (process.env.ADMIN_USERNAMES || "admin")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const role = adminEmails.has(email.toLowerCase()) || adminUsernames.has(username.toLowerCase()) ? "admin" : "user";

  const newUser = await db.insert(usersTable).values({ username, email, passwordHash, role }).returning();
  const createdUser = newUser[0];

  if (!createdUser) {
    set.status = 500;
    return { error: "Failed to create user" };
  }

  const token = await jwt.sign({ userId: createdUser.id, role: createdUser.role });

  set.status = 201;
  return {
    id: createdUser.id,
    username: createdUser.username,
    email: createdUser.email,
    role: createdUser.role,
    balance: createdUser.balance,
    token,
  };
}

export async function handleLogin(context: any) {
  const { body, jwt, set } = context;
  const { email, password } = body;
  const errors = validateLogin(email, password);

  if (errors.length > 0) {
    set.status = 400;
    return { errors };
  }

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    set.status = 401;
    return { error: "Invalid email or password" };
  }

  const token = await jwt.sign({ userId: user.id, role: user.role });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    balance: user.balance,
    token,
  };
}

export async function handleCreateMarket(context: any) {
  const { body, set, user } = context;
  const { title, description, outcomes } = body;
  const errors = validateMarketCreation(title, description || "", outcomes);

  if (errors.length > 0) {
    set.status = 400;
    return { errors };
  }

  const market = await db
    .insert(marketsTable)
    .values({
      title,
      description: description || null,
      createdBy: user.id,
    })
    .returning();
  const createdMarket = market[0];

  if (!createdMarket) {
    set.status = 500;
    return { error: "Failed to create market" };
  }

  const outcomeIds = await db
    .insert(marketOutcomesTable)
    .values(
      outcomes.map((title: string, index: number) => ({
        marketId: createdMarket.id,
        title,
        position: index,
      })),
    )
    .returning();

  set.status = 201;
  return {
    id: createdMarket.id,
    title: createdMarket.title,
    description: createdMarket.description,
    status: createdMarket.status,
    outcomes: outcomeIds,
  };
}

type ListMarketsQuery = {
  status?: "active" | "resolved" | "archived";
  sortBy?: "createdAt" | "totalBets" | "participants";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

type EnrichedMarket = {
  id: number;
  title: string;
  status: "active" | "resolved" | "archived";
  resolvedOutcomeId: number | null;
  creator?: string;
  outcomes: { id: number; title: string; odds: number; totalBets: number }[];
  totalMarketBets: number;
  participantCount: number;
};

export async function handleListMarkets(context: any) {
  const { query } = context as { query: ListMarketsQuery };
  const statusFilter = query.status || "active";
  const sortBy = query.sortBy || "createdAt";
  const sortDir = query.sortDir || "desc";
  const requestedPage = query.page;
  const requestedPageSize = query.pageSize;
  const shouldPaginate = requestedPage !== undefined || requestedPageSize !== undefined;
  const pageSize = Math.min(Math.max(requestedPageSize ?? 20, 1), 100);
  const page = Math.max(requestedPage ?? 1, 1);

  const marketWhere =
    statusFilter === "active"
      ? eq(marketsTable.status, "active")
      : statusFilter === "archived"
        ? or(
            eq(marketsTable.status, "archived"),
            and(eq(marketsTable.status, "resolved"), isNull(marketsTable.resolvedOutcomeId)),
          )
        : and(eq(marketsTable.status, "resolved"), isNotNull(marketsTable.resolvedOutcomeId));

  const markets = await db.query.marketsTable.findMany({
    where: marketWhere,
    with: {
      creator: {
        columns: { username: true },
      },
      outcomes: {
        orderBy: (outcomes, { asc }) => asc(outcomes.position),
      },
    },
  });

  if (markets.length === 0) {
    if (!shouldPaginate) return [];

    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    };
  }

  const marketIds = markets.map((market) => market.id);
  const marketIdSet = new Set(marketIds);

  const marketBetTotals = await db
    .select({
      marketId: betsTable.marketId,
      totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
      participantCount: sql<number>`count(distinct ${betsTable.userId})`,
    })
    .from(betsTable)
    .where(inArray(betsTable.marketId, marketIds))
    .groupBy(betsTable.marketId);

  const outcomeBetTotals = await db
    .select({
      outcomeId: betsTable.outcomeId,
      marketId: betsTable.marketId,
      totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
    })
    .from(betsTable)
    .where(inArray(betsTable.marketId, marketIds))
    .groupBy(betsTable.marketId, betsTable.outcomeId);

  const totalsByMarket = new Map<number, { totalBets: number; participantCount: number }>();
  for (const item of marketBetTotals) {
    totalsByMarket.set(item.marketId, {
      totalBets: Number(item.totalBets ?? 0),
      participantCount: Number(item.participantCount ?? 0),
    });
  }

  const totalsByOutcome = new Map<number, number>();
  for (const item of outcomeBetTotals) {
    if (!marketIdSet.has(item.marketId)) continue;
    totalsByOutcome.set(item.outcomeId, Number(item.totalBets ?? 0));
  }

  const enrichedMarkets: EnrichedMarket[] = markets.map((market) => {
    const aggregate = totalsByMarket.get(market.id) ?? { totalBets: 0, participantCount: 0 };
    const totalMarketBets = aggregate.totalBets;

    return {
      id: market.id,
      title: market.title,
      status: market.status === "resolved" && market.resolvedOutcomeId === null ? "archived" : market.status,
      resolvedOutcomeId: market.resolvedOutcomeId ?? null,
      creator: market.creator?.username,
      outcomes: market.outcomes.map((outcome) => {
        const outcomeBets = totalsByOutcome.get(outcome.id) ?? 0;
        const odds =
          totalMarketBets > 0 ? Number(((outcomeBets / totalMarketBets) * 100).toFixed(2)) : 0;

        return {
          id: outcome.id,
          title: outcome.title,
          odds,
          totalBets: outcomeBets,
        };
      }),
      totalMarketBets,
      participantCount: aggregate.participantCount,
    };
  });

  const createdAtByMarketId = new Map<number, number>();
  for (const market of markets) {
    createdAtByMarketId.set(
      market.id,
      market.createdAt ? new Date(market.createdAt).getTime() : 0,
    );
  }

  const sortedMarkets = enrichedMarkets.sort((a, b) => {
    let comparison = 0;

    if (sortBy === "totalBets") {
      comparison = a.totalMarketBets - b.totalMarketBets;
    } else if (sortBy === "participants") {
      comparison = a.participantCount - b.participantCount;
    } else {
      const timeA = createdAtByMarketId.get(a.id) ?? 0;
      const timeB = createdAtByMarketId.get(b.id) ?? 0;
      comparison = timeA - timeB;
    }

    if (comparison === 0) {
      comparison = a.id - b.id;
    }

    return sortDir === "asc" ? comparison : -comparison;
  });

  const responseItems = sortedMarkets.map((market) => ({
    id: market.id,
    title: market.title,
    status: market.status === "resolved" && market.resolvedOutcomeId === null ? "archived" : market.status,
    creator: market.creator,
    outcomes: market.outcomes,
    totalMarketBets: market.totalMarketBets,
  }));

  if (!shouldPaginate) {
    return responseItems;
  }

  const total = responseItems.length;
  const totalPages = Math.ceil(total / pageSize);
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const offset = (safePage - 1) * pageSize;
  const paginatedItems = responseItems.slice(offset, offset + pageSize);

  return {
    items: paginatedItems,
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export async function handleGetMarket(context: any) {
  const { params, set } = context;
  const market = await db.query.marketsTable.findFirst({
    where: eq(marketsTable.id, params.id),
    with: {
      creator: {
        columns: { username: true },
      },
      outcomes: {
        orderBy: (outcomes, { asc }) => asc(outcomes.position),
      },
    },
  });

  if (!market) {
    set.status = 404;
    return { error: "Market not found" };
  }

  const betsPerOutcome = await Promise.all(
    market.outcomes.map(async (outcome) => {
      const totalBets = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.outcomeId, outcome.id));

      const totalAmount = totalBets.reduce((sum, bet) => sum + bet.amount, 0);
      return { outcomeId: outcome.id, totalBets: totalAmount };
    }),
  );

  const totalMarketBets = betsPerOutcome.reduce((sum, b) => sum + b.totalBets, 0);

  return {
    id: market.id,
    title: market.title,
    description: market.description,
    status: market.status,
    creator: market.creator?.username,
    outcomes: market.outcomes.map((outcome) => {
      const outcomeBets = betsPerOutcome.find((b) => b.outcomeId === outcome.id)?.totalBets || 0;
      const odds =
        totalMarketBets > 0 ? Number(((outcomeBets / totalMarketBets) * 100).toFixed(2)) : 0;

      return {
        id: outcome.id,
        title: outcome.title,
        odds,
        totalBets: outcomeBets,
      };
    }),
    totalMarketBets,
  };
}

export async function handleGetCurrentUser(context: any) {
  const { user, set } = context;

  if (!user) {
    set.status = 401;
    return { error: "Unauthorized" };
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    balance: user.balance,
  };
}

export async function handlePlaceBet(context: any) {
  const { params, body, set, user } = context;
  const marketId = params.id;
  const { outcomeId, amount } = body;
  const errors = validateBet(amount);

  if (errors.length > 0) {
    set.status = 400;
    return { errors };
  }

  const market = await db.query.marketsTable.findFirst({
    where: eq(marketsTable.id, marketId),
  });

  if (!market) {
    set.status = 404;
    return { error: "Market not found" };
  }

  if (market.status !== "active") {
    set.status = 400;
    return { error: "Market is not active" };
  }

  const outcome = await db.query.marketOutcomesTable.findFirst({
    where: and(eq(marketOutcomesTable.id, outcomeId), eq(marketOutcomesTable.marketId, marketId)),
  });

  if (!outcome) {
    set.status = 404;
    return { error: "Outcome not found" };
  }

  const numericAmount = Number(amount);
  if (user.balance < numericAmount) {
    set.status = 400;
    return { error: "Insufficient balance" };
  }

  const bet = await db
    .insert(betsTable)
    .values({
      userId: user.id,
      marketId,
      outcomeId,
      amount: numericAmount,
    })
    .returning();
  const createdBet = bet[0];

  if (!createdBet) {
    set.status = 500;
    return { error: "Failed to place bet" };
  }

  await db
    .update(usersTable)
    .set({ balance: sql`${usersTable.balance} - ${numericAmount}` })
    .where(eq(usersTable.id, user.id));

  const updatedUser = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, user.id),
  });

  set.status = 201;
  return {
    id: createdBet.id,
    userId: createdBet.userId,
    marketId: createdBet.marketId,
    outcomeId: createdBet.outcomeId,
    amount: createdBet.amount,
    userBalance: updatedUser?.balance ?? user.balance - numericAmount,
  };
}

export async function handleResolveMarket(context: any) {
  const { params, body, set, user } = context;

  if (!user || user.role !== "admin") {
    set.status = 403;
    return { error: "Admin access required" };
  }

  const marketId = params.id;
  const { outcomeId } = body;

  const market = await db.query.marketsTable.findFirst({
    where: eq(marketsTable.id, marketId),
  });

  if (!market) {
    set.status = 404;
    return { error: "Market not found" };
  }

  if (market.status !== "active") {
    set.status = 400;
    return { error: "Market is already resolved" };
  }

  const outcome = await db.query.marketOutcomesTable.findFirst({
    where: and(eq(marketOutcomesTable.id, outcomeId), eq(marketOutcomesTable.marketId, marketId)),
  });

  if (!outcome) {
    set.status = 404;
    return { error: "Outcome not found for this market" };
  }

  const marketBets = await db
    .select({
      userId: betsTable.userId,
      outcomeId: betsTable.outcomeId,
      amount: betsTable.amount,
    })
    .from(betsTable)
    .where(eq(betsTable.marketId, marketId));

  const totalMarketPool = marketBets.reduce((sum, bet) => sum + Number(bet.amount), 0);
  const winningBets = marketBets.filter((bet) => bet.outcomeId === outcomeId);
  const winningPool = winningBets.reduce((sum, bet) => sum + Number(bet.amount), 0);

  const payoutsByUser = new Map<number, number>();
  if (winningPool > 0) {
    for (const bet of winningBets) {
      const payout = (Number(bet.amount) * totalMarketPool) / winningPool;
      const current = payoutsByUser.get(bet.userId) ?? 0;
      payoutsByUser.set(bet.userId, current + payout);
    }
  }

  for (const [userId, payout] of payoutsByUser.entries()) {
    await db
      .update(usersTable)
      .set({ balance: sql`${usersTable.balance} + ${Number(payout.toFixed(2))}` })
      .where(eq(usersTable.id, userId));
  }

  await db
    .update(marketsTable)
    .set({
      status: "resolved",
      resolvedOutcomeId: outcomeId,
    })
    .where(eq(marketsTable.id, marketId));

  return {
    marketId,
    status: "resolved",
    resolvedOutcomeId: outcomeId,
    totalPayoutDistributed: Number(
      Array.from(payoutsByUser.values())
        .reduce((sum, value) => sum + value, 0)
        .toFixed(2),
    ),
  };
}

export async function handleArchiveMarket(context: any) {
  const { params, set, user } = context;

  if (!user || user.role !== "admin") {
    set.status = 403;
    return { error: "Admin access required" };
  }

  const marketId = params.id;

  const market = await db.query.marketsTable.findFirst({
    where: eq(marketsTable.id, marketId),
  });

  if (!market) {
    set.status = 404;
    return { error: "Market not found" };
  }

  if (market.status !== "resolved") {
    set.status = 400;
    return { error: "Only resolved markets can be archived" };
  }

  const marketBets = await db
    .select({
      userId: betsTable.userId,
      outcomeId: betsTable.outcomeId,
      amount: betsTable.amount,
    })
    .from(betsTable)
    .where(eq(betsTable.marketId, marketId));

  const totalMarketPool = marketBets.reduce((sum, bet) => sum + Number(bet.amount), 0);
  const winningPool = marketBets
    .filter((bet) => bet.outcomeId === market.resolvedOutcomeId)
    .reduce((sum, bet) => sum + Number(bet.amount), 0);
  const remainingFunds = winningPool > 0 ? 0 : totalMarketPool;

  const refundsRaw = await db
    .select({
      userId: betsTable.userId,
      totalRefund: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
    })
    .from(betsTable)
    .where(eq(betsTable.marketId, marketId))
    .groupBy(betsTable.userId);

  for (const refund of refundsRaw) {
    if (remainingFunds <= 0) break;
    const amountToRefund = Number(refund.totalRefund ?? 0);
    if (amountToRefund <= 0) continue;

    await db
      .update(usersTable)
      .set({ balance: sql`${usersTable.balance} + ${amountToRefund}` })
      .where(eq(usersTable.id, refund.userId));
  }

  await db
    .update(marketsTable)
    .set({
      status: "archived",
    })
    .where(eq(marketsTable.id, marketId));

  const refunds = (remainingFunds > 0 ? refundsRaw : []).map((row) => ({
    userId: row.userId,
    amount: Number(row.totalRefund ?? 0),
  }));
  const totalRefunded = refunds.reduce((sum, item) => sum + item.amount, 0);

  return {
    marketId,
    status: "archived",
    resolutionType: "archived",
    totalRefunded: Number((remainingFunds > 0 ? totalRefunded : 0).toFixed(2)),
    refunds,
  };
}

type ProfileBetsQuery = {
  activePage?: number;
  activePageSize?: number;
  resolvedPage?: number;
  resolvedPageSize?: number;
};

type LeaderboardQuery = {
  page?: number;
  pageSize?: number;
};

export async function handleGetLeaderboard(context: any) {
  const { query } = context as { query: LeaderboardQuery };
  const page = Math.max(query.page ?? 1, 1);
  const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);

  const resolvedBets = await db
    .select({
      userId: betsTable.userId,
      amount: betsTable.amount,
      outcomeId: betsTable.outcomeId,
      marketId: betsTable.marketId,
      resolvedOutcomeId: marketsTable.resolvedOutcomeId,
    })
    .from(betsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, betsTable.marketId))
    .where(inArray(marketsTable.status, ["resolved", "archived"]));

  if (resolvedBets.length === 0) {
    return {
      items: [],
      page,
      pageSize,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    };
  }

  const marketIds = Array.from(new Set(resolvedBets.map((bet) => bet.marketId)));
  const winningOutcomeIds = Array.from(
    new Set(
      resolvedBets
        .map((bet) => bet.resolvedOutcomeId)
        .filter((outcomeId): outcomeId is number => outcomeId !== null),
    ),
  );

  const totalByMarketRows = await db
    .select({
      marketId: betsTable.marketId,
      totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
    })
    .from(betsTable)
    .where(inArray(betsTable.marketId, marketIds))
    .groupBy(betsTable.marketId);

  const totalByWinningOutcomeRows =
    winningOutcomeIds.length > 0
      ? await db
          .select({
            outcomeId: betsTable.outcomeId,
            totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
          })
          .from(betsTable)
          .where(inArray(betsTable.outcomeId, winningOutcomeIds))
          .groupBy(betsTable.outcomeId)
      : [];

  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
    })
    .from(usersTable);

  const marketTotalById = new Map<number, number>();
  for (const row of totalByMarketRows) {
    marketTotalById.set(row.marketId, Number(row.totalBets ?? 0));
  }

  const winningOutcomeTotalById = new Map<number, number>();
  for (const row of totalByWinningOutcomeRows) {
    winningOutcomeTotalById.set(row.outcomeId, Number(row.totalBets ?? 0));
  }

  const usernameById = new Map<number, string>();
  for (const user of users) {
    usernameById.set(user.id, user.username);
  }

  const winningsByUserId = new Map<number, number>();
  for (const bet of resolvedBets) {
    if (bet.resolvedOutcomeId === null || bet.outcomeId !== bet.resolvedOutcomeId) continue;

    const totalMarketBets = marketTotalById.get(bet.marketId) ?? 0;
    const winningOutcomeBets = winningOutcomeTotalById.get(bet.resolvedOutcomeId) ?? 0;
    if (winningOutcomeBets <= 0) continue;

    const payout = (bet.amount * totalMarketBets) / winningOutcomeBets;
    const current = winningsByUserId.get(bet.userId) ?? 0;
    winningsByUserId.set(bet.userId, current + payout);
  }

  const rankedEntries = Array.from(winningsByUserId.entries())
    .map(([userId, totalWinnings]) => ({
      userId,
      username: usernameById.get(userId) ?? `User ${userId}`,
      totalWinnings: Number(totalWinnings.toFixed(2)),
    }))
    .sort((a, b) => {
      if (b.totalWinnings !== a.totalWinnings) return b.totalWinnings - a.totalWinnings;
      return a.username.localeCompare(b.username);
    })
    .map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

  const total = rankedEntries.length;
  const totalPages = Math.ceil(total / pageSize);
  const safePage = totalPages > 0 ? Math.min(page, totalPages) : 1;
  const offset = (safePage - 1) * pageSize;

  return {
    items: rankedEntries.slice(offset, offset + pageSize),
    page: safePage,
    pageSize,
    total,
    totalPages,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

export async function handleGetProfileBets(context: any) {
  const { user, query } = context as { user: typeof usersTable.$inferSelect; query: ProfileBetsQuery };
  const activePageSize = Math.min(Math.max(query.activePageSize ?? 20, 1), 100);
  const resolvedPageSize = Math.min(Math.max(query.resolvedPageSize ?? 20, 1), 100);
  const activePage = Math.max(query.activePage ?? 1, 1);
  const resolvedPage = Math.max(query.resolvedPage ?? 1, 1);

  const [activeCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(betsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, betsTable.marketId))
    .where(and(eq(betsTable.userId, user.id), eq(marketsTable.status, "active")));

  const [resolvedCountRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(betsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, betsTable.marketId))
    .where(
      and(eq(betsTable.userId, user.id), inArray(marketsTable.status, ["resolved", "archived"])),
    );

  const activeTotal = Number(activeCountRow?.count ?? 0);
  const resolvedTotal = Number(resolvedCountRow?.count ?? 0);
  const activeTotalPages = Math.ceil(activeTotal / activePageSize);
  const resolvedTotalPages = Math.ceil(resolvedTotal / resolvedPageSize);
  const safeActivePage = activeTotalPages > 0 ? Math.min(activePage, activeTotalPages) : 1;
  const safeResolvedPage = resolvedTotalPages > 0 ? Math.min(resolvedPage, resolvedTotalPages) : 1;

  const activeBets = await db
    .select({
      betId: betsTable.id,
      marketId: marketsTable.id,
      marketTitle: marketsTable.title,
      outcomeId: marketOutcomesTable.id,
      outcomeTitle: marketOutcomesTable.title,
      amount: betsTable.amount,
      placedAt: betsTable.createdAt,
    })
    .from(betsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, betsTable.marketId))
    .innerJoin(marketOutcomesTable, eq(marketOutcomesTable.id, betsTable.outcomeId))
    .where(and(eq(betsTable.userId, user.id), eq(marketsTable.status, "active")))
    .orderBy(desc(betsTable.createdAt))
    .limit(activePageSize)
    .offset((safeActivePage - 1) * activePageSize);

  const resolvedBets = await db
    .select({
      betId: betsTable.id,
      marketId: marketsTable.id,
      marketTitle: marketsTable.title,
      resolvedOutcomeId: marketsTable.resolvedOutcomeId,
      outcomeId: marketOutcomesTable.id,
      outcomeTitle: marketOutcomesTable.title,
      amount: betsTable.amount,
      placedAt: betsTable.createdAt,
    })
    .from(betsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, betsTable.marketId))
    .innerJoin(marketOutcomesTable, eq(marketOutcomesTable.id, betsTable.outcomeId))
    .where(
      and(eq(betsTable.userId, user.id), inArray(marketsTable.status, ["resolved", "archived"])),
    )
    .orderBy(desc(betsTable.createdAt))
    .limit(resolvedPageSize)
    .offset((safeResolvedPage - 1) * resolvedPageSize);

  const activeMarketIds = Array.from(new Set(activeBets.map((bet) => bet.marketId)));
  const activeOutcomeIds = Array.from(new Set(activeBets.map((bet) => bet.outcomeId)));
  const marketTotalsById = new Map<number, number>();
  const outcomeTotalsById = new Map<number, number>();

  if (activeMarketIds.length > 0) {
    const marketTotals = await db
      .select({
        marketId: betsTable.marketId,
        totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
      })
      .from(betsTable)
      .where(inArray(betsTable.marketId, activeMarketIds))
      .groupBy(betsTable.marketId);

    for (const item of marketTotals) {
      marketTotalsById.set(item.marketId, Number(item.totalBets ?? 0));
    }
  }

  if (activeOutcomeIds.length > 0) {
    const outcomeTotals = await db
      .select({
        outcomeId: betsTable.outcomeId,
        totalBets: sql<number>`coalesce(sum(${betsTable.amount}), 0)`,
      })
      .from(betsTable)
      .where(inArray(betsTable.outcomeId, activeOutcomeIds))
      .groupBy(betsTable.outcomeId);

    for (const item of outcomeTotals) {
      outcomeTotalsById.set(item.outcomeId, Number(item.totalBets ?? 0));
    }
  }

  return {
    active: {
      items: activeBets.map((bet) => {
        const marketTotal = marketTotalsById.get(bet.marketId) ?? 0;
        const outcomeTotal = outcomeTotalsById.get(bet.outcomeId) ?? 0;
        const currentOdds = marketTotal > 0 ? Number(((outcomeTotal / marketTotal) * 100).toFixed(2)) : 0;

        return {
          betId: bet.betId,
          marketId: bet.marketId,
          marketTitle: bet.marketTitle,
          outcomeId: bet.outcomeId,
          outcomeTitle: bet.outcomeTitle,
          amount: bet.amount,
          currentOdds,
          placedAt: bet.placedAt,
        };
      }),
      page: safeActivePage,
      pageSize: activePageSize,
      total: activeTotal,
      totalPages: activeTotalPages,
      hasNext: safeActivePage < activeTotalPages,
      hasPrev: safeActivePage > 1,
    },
    resolved: {
      items: resolvedBets.map((bet) => ({
        betId: bet.betId,
        marketId: bet.marketId,
        marketTitle: bet.marketTitle,
        outcomeId: bet.outcomeId,
        outcomeTitle: bet.outcomeTitle,
        amount: bet.amount,
        result:
          bet.resolvedOutcomeId === null
            ? "refunded"
            : bet.resolvedOutcomeId === bet.outcomeId
              ? "won"
              : "lost",
        placedAt: bet.placedAt,
      })),
      page: safeResolvedPage,
      pageSize: resolvedPageSize,
      total: resolvedTotal,
      totalPages: resolvedTotalPages,
      hasNext: safeResolvedPage < resolvedTotalPages,
      hasPrev: safeResolvedPage > 1,
    },
  };
}
