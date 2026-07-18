// BKQ Market Intelligence
// Version 1.0

async function loadMarketData() {

    try {

        const response = await fetch("data/market.json");

        const data = await response.json();

        document.getElementById("lastUpdated").innerHTML = data.updated;

        document.getElementById("overallBias").innerHTML = data.overallBias;

        document.getElementById("confidence").innerHTML = data.confidence + "%";

        document.getElementById("conviction").innerHTML = data.conviction + "%";

        document.getElementById("convictionBar").style.width =
            data.conviction + "%";

        document.getElementById("tradePlan").innerHTML =
            data.tradePlan;

        document.getElementById("riskLevel").innerHTML =
            data.risk;

        // BTC

        document.getElementById("btcBias").innerHTML =
            data.btc.bias;

        document.getElementById("btcConfidence").innerHTML =
            data.btc.confidence + "%";

        document.getElementById("btcSupport").innerHTML =
            data.btc.support;

        document.getElementById("btcResistance").innerHTML =
            data.btc.resistance;

        document.getElementById("btcTrade").innerHTML =
            data.btc.trade;

        // ETH

        document.getElementById("ethBias").innerHTML =
            data.eth.bias;

        document.getElementById("ethConfidence").innerHTML =
            data.eth.confidence + "%";

        document.getElementById("ethSupport").innerHTML =
            data.eth.support;

        document.getElementById("ethResistance").innerHTML =
            data.eth.resistance;

        document.getElementById("ethTrade").innerHTML =
            data.eth.trade;

        // Scores

        document.getElementById("macroScore").innerHTML =
            data.scores.macro + "%";

        document.getElementById("flowScore").innerHTML =
            data.scores.flows + "%";

        document.getElementById("technicalScore").innerHTML =
            data.scores.technical + "%";

        document.getElementById("riskScore").innerHTML =
            data.scores.risk + "%";

    }

    catch(error){

        console.log(error);

    }

}

loadMarketData();
