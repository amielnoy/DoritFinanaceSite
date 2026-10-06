import { toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type Enquiry } from "../ports";
import { invokeFunction, type FunctionInvoker } from "./invoke";

interface MyAccountBody {
  ok?: boolean;
  rid?: string;
  enquiries?: Record<string, unknown>[];
}

/** The personal area for a visitor signed in through Base44, via the `myAccount` function. */
export class Base44AccountService implements AccountPort {
  constructor(private readonly client: FunctionInvoker) {}

  async myEnquiries(): Promise<Enquiry[]> {
    let body: MyAccountBody | undefined;
    try {
      body = await invokeFunction<MyAccountBody>(this.client, "myAccount", {});
    } catch (e) {
      const err = e as { status?: number; data?: { rid?: string } };
      const reason = err.status === 401 ? "signed_out" : err.status === 403 ? "unverified" : "failed";
      throw new AccountLoadError(reason, err.data?.rid);
    }
    if (!body?.ok || !Array.isArray(body.enquiries)) throw new AccountLoadError("failed", body?.rid);
    return body.enquiries.map(toEnquiry);
  }
}
