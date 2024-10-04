import { CloudWatchClient, GetMetricStatisticsCommand } from "@aws-sdk/client-cloudwatch";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import http from 'http';
import open from 'open';
import readline from 'readline';

// Prompt function based on readline
const prompt = async (question) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const result = await new Promise((resolve) => {
        rl.question(question, resolve);
    });
    rl.close();
    return result;
};

// Prompt for days to look back
const daysToLookBack = await prompt("How many days do you want to look back?\n");

// Prompt for number of functions to include
const nbFunctions = await prompt("How many functions do you want to include?\n");

// Load AWS SDK and create new service objects
const cloudwatch = new CloudWatchClient({});
const lambda = new LambdaClient({});

// Specify the time range for the CloudWatch metrics
const startDate = new Date();
startDate.setDate(startDate.getDate() - daysToLookBack);

// Create an array of days to look back
const days = Array.from({ length: daysToLookBack }, (_, i) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    return date.toISOString().split('T')[0];
});

// Define function to retrieve CloudWatch metrics data
const getMetricsData = async (FunctionName) => {
    const params = {
        EndTime: new Date(),
        StartTime: startDate,
        MetricName: 'Invocations',
        Namespace: 'AWS/Lambda',
        Period: 3600 * 24,
        Statistics: ['Sum'],
        Dimensions: [
            {
                Name: 'FunctionName',
                Value: FunctionName
            }
        ]
    };

    return cloudwatch.send(new GetMetricStatisticsCommand(params));
};

// Define function to build HTML for the chart
const buildHtml = (invocations) => {
    return `
    <div>
        <canvas id="myChart"></canvas>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

    <script>
        const ctx = document.getElementById('myChart');

        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(days)},
                datasets: ${JSON.stringify(invocations.map(inv => ({
                    label: inv.functionName,
                    data: inv.invocations
                })))}
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    </script>
    `;
};

// Define function to retrieve Lambda function data and CloudWatch metrics
async function getData() {
    let marker = null;
    let invocationCounts = [];
    while (true) {
        // List all Lambda functions
        const functions = await lambda.send(new ListFunctionsCommand({
            Marker: marker
        }));

        // Get the metrics data for each function
        const functionsData = await Promise.all(functions.Functions.map(func => getMetricsData(func.FunctionName)));
        invocationCounts.push(...functionsData.map((metricData, index) => ({
            functionName: functions.Functions[index].FunctionName,
            invocations: days.map(day => metricData.Datapoints.find(dp =>
                dp.Timestamp.toISOString().split('T')[0] === day
            )?.Sum || 0),
            invocationsCount: metricData.Datapoints.reduce((sum, datapoint) => sum + (datapoint.Sum || 0), 0)
        })));

        // Break the loop if there are no more functions to list
        if (!functions.NextMarker) {
            break;
        }

        // Set the marker to the next page of functions
        marker = functions.NextMarker;
    }

    // Sort the functions by the number of invocations
    invocationCounts.sort((a, b) => b.invocationsCount - a.invocationsCount);

    return invocationCounts;
}

// Get the Lambda function data and CloudWatch metrics
console.log("Getting data...");
const invocationCounts = await getData();
console.log("Data retrieved");

// Create an HTTP server to serve the HTML page
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildHtml(invocationCounts.slice(0, nbFunctions)));
}).listen(8080);

// Open the browser to view the chart
console.log("Data available at http://localhost:8080");
open('http://localhost:8080');