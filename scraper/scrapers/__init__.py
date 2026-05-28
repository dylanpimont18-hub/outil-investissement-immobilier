from .leboncoin    import LeBonCoinScraper
from .pap          import PapScraper
from .seloger      import SeLogerScraper
from .logicimmo    import LogicImmoScraper
from .bienici      import BienIciScraper
from .orpi         import OrpiScraper
from .century21    import Century21Scraper
from .laforet      import LaforetScraper
from .notaires     import NotairesScraper
from .bellesdemeures import BellesDemeuresScraper

REGISTRY = {
    "leboncoin":     LeBonCoinScraper,
    "pap":           PapScraper,
    "seloger":       SeLogerScraper,
    "logicimmo":     LogicImmoScraper,
    "bienici":       BienIciScraper,
    "orpi":          OrpiScraper,
    "century21":     Century21Scraper,
    "laforet":       LaforetScraper,
    "notaires":      NotairesScraper,
    "bellesdemeures":BellesDemeuresScraper,
}
