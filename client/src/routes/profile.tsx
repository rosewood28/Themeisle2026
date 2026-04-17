import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ProfileBetsResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function ProfilePage() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [data, setData] = useState<ProfileBetsResponse | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [resolvedPage, setResolvedPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfileBets = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      setError(null);
      const profileData = await api.getProfileBets({
        activePage,
        activePageSize: 20,
        resolvedPage,
        resolvedPageSize: 20,
      });
      setData(profileData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile bets");
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    loadProfileBets();
  }, [isAuthenticated, activePage, resolvedPage]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const intervalId = window.setInterval(() => {
      loadProfileBets(false);
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, activePage, resolvedPage]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <p className="text-muted-foreground">Please log in to view your profile</p>
            <Button onClick={() => navigate({ to: "/auth/login" })}>Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="max-w-6xl mx-auto px-4 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Profile</h1>
            <p className="text-gray-600 mt-2">@{user?.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              Back to Markets
            </Button>
            <Button variant="outline" onClick={() => loadProfileBets()} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isLoading && !data ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Loading profile...
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Active Bets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data?.active.items.length ? (
                  data.active.items.map((bet) => (
                    <div
                      key={bet.betId}
                      className="rounded-md border bg-background p-4 flex items-start justify-between gap-4"
                    >
                      <div>
                        <p className="font-semibold">{bet.marketTitle}</p>
                        <p className="text-sm text-muted-foreground">Outcome: {bet.outcomeTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          Amount: ${bet.amount.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Current odds</p>
                        <p className="text-lg font-bold">{bet.currentOdds}%</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No active bets.</p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {data?.active.page ?? 1} of {data?.active.totalPages || 1} (
                    {data?.active.total ?? 0} bets)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={!data?.active.hasPrev || isLoading}
                      onClick={() => setActivePage((prev) => Math.max(prev - 1, 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!data?.active.hasNext || isLoading}
                      onClick={() => setActivePage((prev) => prev + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Resolved Bets</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data?.resolved.items.length ? (
                  data.resolved.items.map((bet) => (
                    <div
                      key={bet.betId}
                      className="rounded-md border bg-background p-4 flex items-start justify-between gap-4"
                    >
                      <div>
                        <p className="font-semibold">{bet.marketTitle}</p>
                        <p className="text-sm text-muted-foreground">Outcome: {bet.outcomeTitle}</p>
                        <p className="text-sm text-muted-foreground">
                          Amount: ${bet.amount.toFixed(2)}
                        </p>
                      </div>
                      <Badge variant={bet.result === "won" ? "default" : "secondary"}>
                        {bet.result === "won" ? "Won" : bet.result === "lost" ? "Lost" : "Refunded"}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">No resolved bets.</p>
                )}
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Page {data?.resolved.page ?? 1} of {data?.resolved.totalPages || 1} (
                    {data?.resolved.total ?? 0} bets)
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      disabled={!data?.resolved.hasPrev || isLoading}
                      onClick={() => setResolvedPage((prev) => Math.max(prev - 1, 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!data?.resolved.hasNext || isLoading}
                      onClick={() => setResolvedPage((prev) => prev + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});
