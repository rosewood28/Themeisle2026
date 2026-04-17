import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Market, MarketsListResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MarketCard } from "@/components/market-card";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function DashboardPage() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [markets, setMarkets] = useState<Array<Market>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "resolved" | "archived">("active");
  const [sortBy, setSortBy] = useState<"createdAt" | "totalBets" | "participants">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Omit<MarketsListResponse, "items">>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [selectedResolutionOutcome, setSelectedResolutionOutcome] = useState<Partial<Record<number, number>>>(
    {},
  );
  const [resolvingMarketId, setResolvingMarketId] = useState<number | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [pendingAdminAction, setPendingAdminAction] = useState<{
    type: "resolve" | "archive";
    marketId: number;
    outcomeId?: number;
    marketTitle: string;
  } | null>(null);

  const applyMarketsPayload = (data: Array<Market> | MarketsListResponse) => {
    if (Array.isArray(data)) {
      setMarkets(data);
      setPagination({
        page: 1,
        pageSize: data.length,
        total: data.length,
        totalPages: data.length > 0 ? 1 : 0,
        hasNext: false,
        hasPrev: false,
      });
      return;
    }

    setMarkets(data.items);
    setPagination({
      page: data.page,
      pageSize: data.pageSize,
      total: data.total,
      totalPages: data.totalPages,
      hasNext: data.hasNext,
      hasPrev: data.hasPrev,
    });
  };

  const loadMarkets = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      setError(null);
      const data = await api.listMarkets({
        status,
        sortBy,
        sortDir,
        page,
        pageSize: 20,
      });
      applyMarketsPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load markets");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadMarkets();
  }, [status, sortBy, sortDir, page]);

  useEffect(() => {
    setSelectedResolutionOutcome((current) => {
      const next = { ...current };
      for (const market of markets) {
        if (next[market.id] === undefined && market.outcomes.length > 0) {
          next[market.id] = market.outcomes[0].id;
        }
      }
      return next;
    });
  }, [markets]);

  const handleAdminResolve = async (marketId: number) => {
    const outcomeId = selectedResolutionOutcome[marketId];
    if (!outcomeId) {
      setError("Please select an outcome first.");
      return;
    }

    try {
      setResolvingMarketId(marketId);
      await api.resolveMarket(marketId, outcomeId);
      await loadMarkets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve market");
    } finally {
      setResolvingMarketId(null);
    }
  };

  const handleAdminArchive = async (marketId: number) => {
    try {
      setResolvingMarketId(marketId);
      await api.archiveMarket(marketId);
      await loadMarkets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to archive market");
    } finally {
      setResolvingMarketId(null);
    }
  };

  const openResolveConfirm = (market: Market) => {
    const outcomeId = selectedResolutionOutcome[market.id];
    if (!outcomeId) {
      setError("Please select an outcome first.");
      return;
    }
    setPendingAdminAction({
      type: "resolve",
      marketId: market.id,
      outcomeId,
      marketTitle: market.title,
    });
    setConfirmDialogOpen(true);
  };

  const openArchiveConfirm = (market: Market) => {
    setPendingAdminAction({
      type: "archive",
      marketId: market.id,
      marketTitle: market.title,
    });
    setConfirmDialogOpen(true);
  };

  const confirmAdminAction = async () => {
    if (!pendingAdminAction) return;
    setConfirmDialogOpen(false);

    if (pendingAdminAction.type === "resolve" && pendingAdminAction.outcomeId) {
      await handleAdminResolve(pendingAdminAction.marketId);
      return;
    }

    await handleAdminArchive(pendingAdminAction.marketId);
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const streamUrl = api.getMarketsStreamUrl({
      status,
      sortBy,
      sortDir,
      page,
      pageSize: 20,
    });
    const eventSource = new EventSource(streamUrl);
    let fallbackIntervalId: number | null = null;

    eventSource.addEventListener("markets", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as {
        data: Array<Market> | MarketsListResponse;
        ts: number;
      };
      setError(null);
      applyMarketsPayload(parsed.data);
      setIsLoading(false);
    });

    eventSource.addEventListener("error", () => {
      if (fallbackIntervalId === null) {
        fallbackIntervalId = window.setInterval(() => {
          void loadMarkets(false);
        }, 5000);
      }
    });

    return () => {
      eventSource.close();
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
    };
  }, [isAuthenticated, status, sortBy, sortDir, page]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-4 text-gray-900">Prediction Markets</h1>
          <p className="text-gray-600 mb-8 text-lg">Create and participate in prediction markets</p>
          <div className="space-x-4">
            <Button onClick={() => navigate({ to: "/auth/login" })}>Login</Button>
            <Button variant="outline" onClick={() => navigate({ to: "/auth/register" })}>
              Sign Up
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Markets</h1>
            <p className="text-gray-600 mt-2">Welcome back, {user?.username}!</p>
            <p className="text-gray-700 text-sm mt-1">Balance: ${Number(user?.balance ?? 0).toFixed(2)}</p>
            {user?.role === "admin" && (
              <p className="text-amber-700 text-sm mt-1">Admin mode: you can resolve active markets.</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => navigate({ to: "/leaderboard" })}>
              Leaderboard
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: "/profile" })}>
              Profile
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: "/auth/logout" })}>
              Logout
            </Button>
            <Button onClick={() => navigate({ to: "/markets/new" })}>Create Market</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4 items-center">
          <Button
            variant={status === "active" ? "default" : "outline"}
            onClick={() => {
              setStatus("active");
              setPage(1);
            }}
          >
            Active Markets
          </Button>
          <Button
            variant={status === "resolved" ? "default" : "outline"}
            onClick={() => {
              setStatus("resolved");
              setPage(1);
            }}
          >
            Resolved Markets
          </Button>
          <Button
            variant={status === "archived" ? "default" : "outline"}
            onClick={() => {
              setStatus("archived");
              setPage(1);
            }}
          >
            Archived Markets
          </Button>
          <select
            value={sortBy}
            onChange={(event) => {
              setSortBy(event.target.value as "createdAt" | "totalBets" | "participants");
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="createdAt">Sort: Creation Date</option>
            <option value="totalBets">Sort: Total Bet Size</option>
            <option value="participants">Sort: Participants</option>
          </select>
          <select
            value={sortDir}
            onChange={(event) => {
              setSortDir(event.target.value as "asc" | "desc");
              setPage(1);
            }}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="desc">Direction: Descending</option>
            <option value="asc">Direction: Ascending</option>
          </select>
          <Button variant="outline" onClick={() => loadMarkets()} disabled={isLoading}>
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {/* Error State */}
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive mb-6">
            {error}
          </div>
        )}

        {/* Markets Grid */}
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <p className="text-muted-foreground">Loading markets...</p>
            </CardContent>
          </Card>
        ) : markets.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="text-center">
                <p className="text-muted-foreground text-lg">
                  No {status} markets found. {status === "active" && "Create one to get started!"}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {markets.map((market) => (
                <div key={market.id} className="space-y-2">
                  <MarketCard market={market} />
                  {user?.role === "admin" && market.status === "active" && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                      <p className="text-xs font-medium text-amber-800">Admin Controls</p>
                      <select
                        value={selectedResolutionOutcome[market.id] ?? ""}
                        onChange={(event) =>
                          setSelectedResolutionOutcome((current) => ({
                            ...current,
                            [market.id]: Number(event.target.value),
                          }))
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {market.outcomes.map((outcome) => (
                          <option key={outcome.id} value={outcome.id}>
                            {outcome.title}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-1 gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={resolvingMarketId === market.id}
                          onClick={() => openResolveConfirm(market)}
                        >
                          Resolve
                        </Button>
                      </div>
                    </div>
                  )}
                  {user?.role === "admin" && market.status === "resolved" && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                      <p className="text-xs font-medium text-amber-800">Admin Controls</p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolvingMarketId === market.id}
                        onClick={() => openArchiveConfirm(market)}
                      >
                        Archive
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between rounded-md border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} markets)
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled={!pagination.hasPrev || isLoading}
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={!pagination.hasNext || isLoading}
                  onClick={() => setPage((prev) => prev + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
        <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingAdminAction?.type === "resolve" ? "Resolve market?" : "Archive market?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingAdminAction?.type === "resolve"
                  ? `This will resolve "${pendingAdminAction.marketTitle}" with the selected winning outcome and distribute payouts.`
                  : `This will archive "${pendingAdminAction?.marketTitle}" and refund any remaining undistributed funds.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={confirmAdminAction}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: DashboardPage,
});
