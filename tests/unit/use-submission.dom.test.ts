/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CONTACT } from "@/config/contact";
import { submissionErrorMessage, useSubmission } from "@/hooks/useSubmission";

describe("submissionErrorMessage", () => {
  it("names what failed to send", () => {
    expect(submissionErrorMessage("message")).toContain("את ההודעה");
    expect(submissionErrorMessage("form")).toContain("את הטופס");
    expect(submissionErrorMessage("request")).toContain("את הבקשה");
    expect(submissionErrorMessage("report")).toContain("את הדיווח");
  });

  it("takes the fallback address from config, never from the copy", () => {
    for (const subject of ["message", "form", "request", "report"] as const) {
      expect(submissionErrorMessage(subject)).toContain(CONTACT.email);
    }
  });
});

describe("useSubmission", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useSubmission());
    expect(result.current.state).toBe("idle");
    expect(result.current.sending).toBe(false);
    expect(result.current.sent).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("moves idle → sending → sent and reports success", async () => {
    const { result } = renderHook(() => useSubmission());
    let outcome: boolean | undefined;

    await act(async () => {
      outcome = await result.current.submit(async () => "ok");
    });

    expect(outcome).toBe(true);
    expect(result.current.state).toBe("sent");
    expect(result.current.sent).toBe(true);
    expect(result.current.error).toBe("");
  });

  it("moves to error with the right copy and reports failure", async () => {
    const { result } = renderHook(() => useSubmission("form"));
    let outcome: boolean | undefined;

    await act(async () => {
      outcome = await result.current.submit(async () => {
        throw new Error("backend down");
      });
    });

    expect(outcome).toBe(false);
    expect(result.current.state).toBe("error");
    expect(result.current.sent).toBe(false);
    expect(result.current.error).toContain("את הטופס");
    expect(result.current.error).toContain(CONTACT.email);
  });

  it("runs the task once when submitted twice concurrently", async () => {
    const task = vi.fn(async () => new Promise((r) => setTimeout(r, 20)));
    const { result } = renderHook(() => useSubmission());

    await act(async () => {
      await Promise.all([result.current.submit(task), result.current.submit(task)]);
    });

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("clears the previous error when resubmitting", async () => {
    const { result } = renderHook(() => useSubmission());

    await act(async () => {
      await result.current.submit(async () => {
        throw new Error("nope");
      });
    });
    expect(result.current.error).not.toBe("");

    await act(async () => {
      await result.current.submit(async () => "ok");
    });
    await waitFor(() => expect(result.current.error).toBe(""));
    expect(result.current.state).toBe("sent");
  });

  it("reset returns it to idle", async () => {
    const { result } = renderHook(() => useSubmission());
    await act(async () => {
      await result.current.submit(async () => "ok");
    });

    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.sent).toBe(false);
  });
});
