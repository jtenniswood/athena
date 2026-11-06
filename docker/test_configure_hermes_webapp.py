import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("configure_webapp", Path(__file__).with_name("configure-hermes-webapp.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WebappSettingsTest(unittest.TestCase):
    def test_compose_values_normalize_to_typed_config(self):
        self.assertEqual(module.webapp_settings({
            "HERMES_WEBAPP_PUBLIC_URL": "https://athena.example.com/",
            "HERMES_WEBAPP_HOST": "::", "HERMES_WEBAPP_PORT": "9130",
        }), {"enabled": True, "host": "::", "port": 9130, "public_url": "https://athena.example.com"})

    def test_disabled_listener_needs_no_public_url_or_other_overrides(self):
        self.assertEqual(module.webapp_settings({"HERMES_WEBAPP_ENABLED": "false"}), {"enabled": False})
        self.assertEqual(module.webapp_settings({"ATHENA_PUBLIC_URL": "http://localhost:4174"})["public_url"], "http://localhost:4174")

    def test_bad_settings_are_refused_before_the_config_writer_is_imported(self):
        for values in [
            {}, {"HERMES_WEBAPP_ENABLED": "maybe"},
            {"HERMES_WEBAPP_PORT": "0"}, {"HERMES_WEBAPP_PORT": "65536"},
            {"HERMES_WEBAPP_PORT": "not-a-port"}, {"HERMES_WEBAPP_HOST": "bad host"},
            {"HERMES_WEBAPP_PUBLIC_URL": "https://user:secret@athena.example.com"},
            {"HERMES_WEBAPP_PUBLIC_URL": "https://athena.example.com/path"},
            {"HERMES_WEBAPP_PUBLIC_URL": "https://athena.example.com:invalid"},
        ]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                module.configure(values)


if __name__ == "__main__":
    unittest.main()
