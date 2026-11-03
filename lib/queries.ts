export const ANALYTICS_QUERY = `query DashboardAnalytics($query: String!) { shop { id name currencyCode ianaTimezone } shopifyqlQuery(query: $query) { parseErrors tableData { columns { name dataType } rows } } }`;
export const ENGAGEMENT_QUERY = `query DashboardEngagement($query: String!) { shop { id name currencyCode ianaTimezone } shopifyqlQuery(query: $query) { parseErrors tableData { columns { name dataType } rows } } }`;
export const ATTRIBUTION_QUERY = `query DashboardAttribution($ids: [ID!]!) { shop { id } nodes(ids: $ids) { ... on Order { id tags customAttributes { key value } } } }`;
export const PRODUCTS_QUERY = `query DashboardProducts($query: String!) { shop { id name currencyCode ianaTimezone } shopifyqlQuery(query: $query) { parseErrors tableData { columns { name dataType } rows } } }`;
export const METRICS = 'total_sales, net_sales, orders, gross_sales, discounts, sales_reversals';
