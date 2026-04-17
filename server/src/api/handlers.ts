import { eq, and, inArray, sql, desc } from "drizzle-orm";
import db from "../db";
import { usersTable, marketsTable, marketOutcomesTable, betsTable } from "../db/schema";
import { hashPassword, verifyPassword, type AuthTokenPayload } from "../lib/auth";
import {
  validateRegistration,
  validateLogin,
  validateMarketCreation,
  validateBet,
} from "../lib/validation";

type JwtSigner = {
  sign: (payload: AuthTokenPayload) => Promise<string>;
};

export async function handleRegister({
  body,
  jwt,
  set,
}: {
  body: { username: string; email: string; password: string };
  jwt: JwtSigner;
  set: { status: number };
}) {
  const { username, email, password } = body;
  const errors = validateRegistration(username, email, password);

  if (errors.length > 0) {
    set.status = 400;
    return { errors };
  }

  const existingUser = await db.query.usersTable.findFirst({
    where: (users, { or, eq }) => or(eq(users.email, email), eq(users.username, username)),
  });

  if (existingUser) {
    set.status = 409;
    return { errors: [{ field: "email", message: "User already exists" }] };
  }

  const passwordHash = await hashPassword(password);

  const newUser = await db.insert(usersTable).values({ username, email, passwordHash }).returning();

  const token = await jwt.sign({ userId: newUser[0].id });

  set.status = 201;
  return {
    id: newUser[0].id,
    username: newUser[0].username,
    email: newUser[0].email,
    token,
  };
}

export async function handleLogin({
  body,
  jwt,
  set,
}: {
  body: { email: string; password: string };
  jwt: JwtSigner;
  set: { status: number };
}) {
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

  const token = await jwt.sign({ userId: user.id });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    token,
  };
}

export async function handleCreateMarket({
  body,
  set,
  user,
}: {
  body: { title: string; description?: string; outcomes: string[] };
  set: { status: number };
  user: typeof usersTable.$inferSelect;
}) {
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

  const outcomeIds = await db
    .insert(marketOutcomesTable)
    .values(
      outcomes.map((title: string, index: number) => ({
        marketId: market[0].id,
        title,
        position: index,
      })),
    )
    .returning();

  set.status = 201;
  return {
    id: market[0].id,
    title: market[0].title,
    description: market[0].description,
    status: market[0].status,
    outcomes: outcomeIds,
  };
}

type ListMarketsQuery = {
  status?: "active" | "resolved";
  sortBy?: "createdAt" | "totalBets" | "participants";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

type EnrichedMarket = {
  id: number;
  title: string;
  status: "active" | "resolved";
  creator?: string;
  outcomes: { id: number; title: string; odds: number; totalBets: number }[];
  totalMarketBets: number;
  participantCount: number;
};

export async function handleListMarkets({ query }: { query: ListMarketsQuery }) {
  const statusFilter = query.status || "active";
  const sortBy = query.sortBy || "createdAt";
  const sortDir = query.sortDir || "desc";
  const requestedPage = query.page;
  const requestedPageSize = query.pageSize;
  const shouldPaginate = requestedPage !== undefined || requestedPageSize !== undefined;
  const pageSize = Math.min(Math.max(requestedPageSize ?? 20, 1), 100);
  const page = Math.max(requestedPage ?? 1, 1);

  const markets = await db.query.marketsTable.findMany({
    where: eq(marketsTable.status, statusFilter),
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
      status: market.status,
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
    status: market.status,
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

export async function handleGetMarket({
  params,
  set,
}: {
  params: { id: number };
  set: { status: number };
}) {
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

export async function handlePlaceBet({
  params,
  body,
  set,
  user,
}: {
  params: { id: number };
  body: { outcomeId: number; amount: number };
  set: { status: number };
  user: typeof usersTable.$inferSelect;
}) {
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

  const bet = await db
    .insert(betsTable)
    .values({
      userId: user.id,
      marketId,
      outcomeId,
      amount: Number(amount),
    })
    .returning();

  set.status = 201;
  return {
    id: bet[0].id,
    userId: bet[0].userId,
    marketId: bet[0].marketId,
    outcomeId: bet[0].outcomeId,
    amount: bet[0].amount,
  };
}

type ProfileBetsQuery = {
  activePage?: number;
  activePageSize?: number;
  resolvedPage?: number;
  resolvedPageSize?: number;
};

export async function handleGetProfileBets({
  user,
  query,
}: {
  user: typeof usersTable.$inferSelect;
  query: ProfileBetsQuery;
}) {
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
    .where(and(eq(betsTable.userId, user.id), eq(marketsTable.status, "resolved")));

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
    .where(and(eq(betsTable.userId, user.id), eq(marketsTable.status, "resolved")))
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
        result: bet.resolvedOutcomeId === bet.outcomeId ? "won" : "lost",
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
