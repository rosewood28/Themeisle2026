const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4001";

// Types
export interface Market {
  id: number;
  title: string;
  description?: string;
  status: "active" | "resolved" | "archived";
  creator?: string;
  outcomes: Array<MarketOutcome>;
  totalMarketBets: number;
}

export interface MarketsListQuery {
  status?: "active" | "resolved" | "archived";
  sortBy?: "createdAt" | "totalBets" | "participants";
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface MarketsListResponse {
  items: Array<Market>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface MarketOutcome {
  id: number;
  title: string;
  odds: number;
  totalBets: number;
}

export interface User {
  id: number;
  username: string;
  email: string;
  role: "admin" | "user";
  balance: number;
  token: string;
}

export type CurrentUser = Omit<User, "token">;

export interface Bet {
  id: number;
  userId: number;
  marketId: number;
  outcomeId: number;
  amount: number;
  userBalance: number;
  createdAt: string;
}

export interface UserActiveBet {
  betId: number;
  marketId: number;
  marketTitle: string;
  outcomeId: number;
  outcomeTitle: string;
  amount: number;
  currentOdds: number;
  placedAt: string;
}

export interface UserResolvedBet {
  betId: number;
  marketId: number;
  marketTitle: string;
  outcomeId: number;
  outcomeTitle: string;
  amount: number;
  result: "won" | "lost" | "refunded";
  placedAt: string;
}

export interface PaginatedProfileList<T> {
  items: Array<T>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface ProfileBetsResponse {
  active: PaginatedProfileList<UserActiveBet>;
  resolved: PaginatedProfileList<UserResolvedBet>;
}

export interface LeaderboardEntry {
  rank: number;
  userId: number;
  username: string;
  totalWinnings: number;
}

export interface LeaderboardResponse {
  items: Array<LeaderboardEntry>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// API Client
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private getAuthHeader() {
    const token = localStorage.getItem("auth_token");
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
      ...this.getAuthHeader(),
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      // If there are validation errors, throw them
      if (data.errors && Array.isArray(data.errors)) {
        const errorMessage = data.errors.map((e: any) => `${e.field}: ${e.message}`).join(", ");
        throw new Error(errorMessage);
      }
      throw new Error(data.error || `API Error: ${response.status}`);
    }

    return data ?? {};
  }

  // Auth endpoints
  async register(username: string, email: string, password: string): Promise<User> {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
  }

  async login(email: string, password: string): Promise<User> {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async getCurrentUser(): Promise<CurrentUser> {
    return this.request("/api/auth/me");
  }

  // Markets endpoints
  async listMarkets(query: MarketsListQuery = {}): Promise<Array<Market> | MarketsListResponse> {
    const params = new URLSearchParams();
    const status = query.status ?? "active";
    params.set("status", status);

    if (query.sortBy) params.set("sortBy", query.sortBy);
    if (query.sortDir) params.set("sortDir", query.sortDir);
    if (query.page !== undefined) params.set("page", String(query.page));
    if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));

    return this.request(`/api/markets?${params.toString()}`);
  }

  async getMarket(id: number): Promise<Market> {
    return this.request(`/api/markets/${id}`);
  }

  async createMarket(title: string, description: string, outcomes: Array<string>): Promise<Market> {
    return this.request("/api/markets", {
      method: "POST",
      body: JSON.stringify({ title, description, outcomes }),
    });
  }

  // Bets endpoints
  async placeBet(marketId: number, outcomeId: number, amount: number): Promise<Bet> {
    return this.request(`/api/markets/${marketId}/bets`, {
      method: "POST",
      body: JSON.stringify({ outcomeId, amount }),
    });
  }

  async resolveMarket(marketId: number, outcomeId: number): Promise<{
    marketId: number;
    status: "resolved";
    resolvedOutcomeId: number;
  }> {
    return this.request(`/api/markets/${marketId}/resolve`, {
      method: "POST",
      body: JSON.stringify({ outcomeId }),
    });
  }

  async archiveMarket(marketId: number): Promise<{
    marketId: number;
    status: "resolved";
    resolutionType: "archived";
    totalRefunded: number;
    refunds: Array<{ userId: number; amount: number }>;
  }> {
    return this.request(`/api/markets/${marketId}/archive`, {
      method: "POST",
    });
  }

  async getProfileBets(query: {
    activePage?: number;
    activePageSize?: number;
    resolvedPage?: number;
    resolvedPageSize?: number;
  }): Promise<ProfileBetsResponse> {
    const params = new URLSearchParams();

    if (query.activePage !== undefined) params.set("activePage", String(query.activePage));
    if (query.activePageSize !== undefined) params.set("activePageSize", String(query.activePageSize));
    if (query.resolvedPage !== undefined) params.set("resolvedPage", String(query.resolvedPage));
    if (query.resolvedPageSize !== undefined) {
      params.set("resolvedPageSize", String(query.resolvedPageSize));
    }

    return this.request(`/api/markets/profile/bets?${params.toString()}`);
  }

  async getLeaderboard(query: { page?: number; pageSize?: number } = {}): Promise<LeaderboardResponse> {
    const params = new URLSearchParams();
    params.set("page", String(query.page ?? 1));
    params.set("pageSize", String(query.pageSize ?? 20));

    return this.request(`/api/markets/leaderboard?${params.toString()}`);
  }
}

export const api = new ApiClient(API_BASE_URL);
