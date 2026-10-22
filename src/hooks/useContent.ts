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
  // `["testimonials"]` stays the prefix, so useAdmin.ts's invalidation still reaches every agency's list.
  testimonials: (limit: number, agencyId?: string) => ["testimonials", limit, agencyId ?? null] as const,
};

export function useArticles(limit = 50) {
  return useQuery<Article[]>({
    queryKey: contentKeys.articles(limit),
    queryFn: () => services.content.listArticles(limit),
    staleTime: 5 * 60 * 1000,
  });
}

export function useArticle(key: string | undefined) {
  return useQuery<Article>({
    queryKey: contentKeys.article(key),
    queryFn: () => services.content.getArticle(key as string),
    enabled: !!key,
    retry: false, // a missing article is an answer, not a failure to retry
    // Fresh for as long as the lists are. BlogPost.tsx seeds the slug's key
    // when it moves an old address there, and that copy must not be re-read.
    staleTime: 5 * 60 * 1000,
  });
}

export function useTestimonials(limit = 50, agencyId?: string) {
  return useQuery<Testimonial[]>({
    queryKey: contentKeys.testimonials(limit, agencyId),
    // No agency, no second argument: the port is asked exactly what it always was.
    queryFn: () =>
      agencyId === undefined
        ? services.content.listTestimonials(limit)
        : services.content.listTestimonials(limit, agencyId),
    staleTime: 5 * 60 * 1000,
  });
}
