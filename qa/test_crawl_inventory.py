import unittest
from unittest.mock import patch
from qa.crawl_inventory import PageParser, is_event_url, normalized_url, validate_register, compare_with_register, sitemap_urls
class AuditTests(unittest.TestCase):
    def test_event_filter(self):
        self.assertTrue(is_event_url("https://www.electroniccph.com/events/a"))
        self.assertFalse(is_event_url("https://www.electroniccph.com/artists/a"))
    def test_normalization(self):
        self.assertEqual(normalized_url("https://SITE.com/events/A/"),normalized_url("https://site.com/events/a"))
    def test_html(self):
        p=PageParser();p.feed('<title>Sample</title><link rel="canonical" href="https://a/b"><a href="/tickets">Buy</a>')
        self.assertEqual(p.title,"Sample");self.assertEqual(p.canonical,"https://a/b");self.assertEqual(p.links,["/tickets"])
    def test_anchor_labels(self):
        p=PageParser();p.feed('<a href="/tickets">TICKETS</a><a href="/official">OFFICIAL EVENT</a>')
        self.assertEqual([a["text"] for a in p.anchors],["TICKETS","OFFICIAL EVENT"])
    def test_register(self):
        r={"schema_version":1,"issues":[{"id":"a","status":"historical_unverified"}]}
        self.assertTrue(validate_register(r))
        with self.assertRaises(ValueError):validate_register({"schema_version":1,"issues":[r["issues"][0],r["issues"][0]]})
    def test_delta_does_not_claim_verified(self):
        r={"schema_version":1,"issues":[{"id":"a","status":"historical_unverified"},{"id":"b","status":"resolved"}]}
        d=compare_with_register([{"id":"a"},{"id":"b"},{"id":"c"}],r)
        self.assertEqual([x["delta"] for x in d],["candidate_reappeared_unverified","candidate_new_unverified"])
    def test_sitemap(self):
        xml='<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://site/events/1</loc></url></urlset>'
        with patch("qa.crawl_inventory.fetch",return_value={"html":xml}):
            self.assertEqual(sitemap_urls("https://site/sitemap.xml"),["https://site/events/1"])
if __name__=="__main__":unittest.main()
