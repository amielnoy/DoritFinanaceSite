import { useQuery } from "@tanstack/react-query";
import { services } from "@/services";
import type { Article, Testimonial } from "@/services";

/**
 * The single data-fetching idiom for published content.
 *
 * React Query was already installed, configured with retry and
 * refetchOnWindowFocus, and mounted at the root — yet 14 files hand-rolled
 * `useEffect` plus manual loading/error state, with no caching, no retry and no
 * deduplication. Three components asking for testimonials made three requests.
 *
 * These hooks depend on the ContentPort, not on the Base44 SDK, so a test
 * substitutes a fake service rather than mocking a vendor module.
 */

export const contentKeys = {
  articles: (limit: number) => ["articles", limit] as const,
  article: (id: string | undefined) => ["article", id] as const,
  testimonials: (limit: number) => ["testimonials", limit] as const,
};

export function useArticles(limit = 50) {
  return useQuery<Article[]>({
    queryKey: contentKeys.articles(limit),
    queryFn: () => services.content.listArticles(limit),
    staleTime: 5 * 60 * 1000,
  });
}

export function useArticle(id: string | undefined) {
  return useQuery<Article>({
    queryKey: contentKeys.article(id),
    queryFn: () => services.content.getArticle(id as string),
    enabled: !!id,
    retry: false, // a missing article is an answer, not a failure to retry
  });
}

export function useTestimonials(limit = 50) {
  return useQuery<Testimonial[]>({
    queryKey: contentKeys.testimonials(limit),
    queryFn: () => services.content.listTestimonials(limit),
    staleTime: 5 * 60 * 1000,
  });
}
