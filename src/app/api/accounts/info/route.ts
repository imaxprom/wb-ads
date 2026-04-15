import { NextResponse } from "next/server";
import { loadTokens, getValidTokens } from "@/lib/wb-seller-api";

export async function GET() {
  try {
    const tokens = loadTokens();
    if (!tokens) return NextResponse.json({ supplier_id: "", supplier_name: "", store_name: "" });

    // Try to get supplier name from the seller API
    let supplierName = "";
    let storeName = "";

    const valid = await getValidTokens();
    if (valid) {
      try {
        const res = await fetch(
          "https://seller.wildberries.ru/ns/suppliers/suppliers-portal-core/suppliers",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorizev3: valid.authorizev3,
              cookie: valid.cookies || "",
              origin: "https://seller.wildberries.ru",
              referer: "https://seller.wildberries.ru/",
            },
            body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const suppliers = data?.result?.suppliers || data?.result || [];
          if (Array.isArray(suppliers) && suppliers.length > 0) {
            const s = suppliers[0];
            supplierName = s.name || s.fullName || s.legalName || "";
            storeName = s.trademark || s.brandName || s.storeName || "";
          }
        }
      } catch { /* skip */ }
    }

    return NextResponse.json({
      supplier_id: tokens.supplierId || "",
      supplier_name: supplierName,
      store_name: storeName,
    });
  } catch {
    return NextResponse.json({ supplier_id: "", supplier_name: "", store_name: "" });
  }
}
