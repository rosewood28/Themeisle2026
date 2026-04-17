import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { LeaderboardEntry, LeaderboardResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function LeaderboardPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [entries, setEntries] = useState<Array<LeaderboardEntry>>([]);
  const [pagination, setPagination] = useState<Omit<LeaderboardResponse, "items">>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboard = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      setError(null);
      const data = await api.getLeaderboard({ page, pageSize: 20 });
      setEntries(data.items);
      setPagination({
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: data.totalPages,
        hasNext: data.hasNext,
        hasPrev: data.hasPrev,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadLeaderboard();
  }, [page]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadLeaderboard(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [page]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-muted-foreground">Please log in to view the leaderboard</p>
            <Button onClick={() => navigate({ to: "/auth/login" })}>Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="max-w-4xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-gray-900">Leaderboard</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              Back to Markets
            </Button>
            <Button variant="outline" onClick={() => loadLeaderboard()} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Top Winners</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Loading leaderboard...</p>
            ) : entries.length === 0 ? (
              <p className="text-muted-foreground">No resolved winnings yet.</p>
            ) : (
              <>
                <div className="space-y-3">
                  {entries.map((entry) => (
                    <div
                      key={entry.userId}
                      className="flex items-center justify-between rounded-md border bg-background p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-8 text-center font-bold text-primary">#{entry.rank}</span>
                        <span className="font-semibold">{entry.username}</span>
                      </div>
                      <span className="text-lg font-bold text-primary">
                        ${entry.totalWinnings.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages || 1} ({pagination.total} users)
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
});
